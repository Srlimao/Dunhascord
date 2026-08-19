#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <audiopolicy.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <io.h>
#include <fcntl.h>

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "User32.lib")

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

class AudioActivationHandler : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
public:
    HANDLE completionEvent;
    ComPtr<IAudioClient> audioClient;
    HRESULT activationResult;

    AudioActivationHandler() : completionEvent(CreateEvent(nullptr, FALSE, FALSE, nullptr)), activationResult(E_FAIL) {}
    ~AudioActivationHandler() { if (completionEvent) CloseHandle(completionEvent); }

    STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
        IUnknown* unk = nullptr;
        HRESULT hr = operation->GetActivateResult(&activationResult, &unk);
        if (SUCCEEDED(hr) && SUCCEEDED(activationResult) && unk) {
            unk->QueryInterface(IID_PPV_ARGS(&audioClient));
            unk->Release();
        }
        SetEvent(completionEvent);
        return S_OK;
    }
};

std::string CleanAlphaNum(const std::string& input) {
    std::string out = "";
    for (char c : input) {
        if (isalnum((unsigned char)c)) out += (char)tolower((unsigned char)c);
    }
    return out;
}

DWORD FindActiveAudioPidByName(const std::string& searchName) {
    std::string sClean = CleanAlphaNum(searchName);
    if (sClean.empty()) return 0;

    ComPtr<IMMDeviceEnumerator> enumerator;
    if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) return 0;

    ComPtr<IMMDevice> device;
    if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device))) return 0;

    ComPtr<IAudioSessionManager2> sessionManager;
    if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, &sessionManager))) return 0;

    ComPtr<IAudioSessionEnumerator> sessionEnum;
    if (FAILED(sessionManager->GetSessionEnumerator(&sessionEnum))) return 0;

    int sessionCount = 0;
    sessionEnum->GetCount(&sessionCount);
    std::cerr << "[NativeAudio] Total active audio sessions found: " << sessionCount << std::endl;

    for (int i = 0; i < sessionCount; i++) {
        ComPtr<IAudioSessionControl> control;
        if (SUCCEEDED(sessionEnum->GetSession(i, &control))) {
            ComPtr<IAudioSessionControl2> control2;
            if (SUCCEEDED(control.As(&control2))) {
                DWORD pid = 0;
                control2->GetProcessId(&pid);
                if (pid > 0) {
                    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
                    if (hProc) {
                        char exePath[MAX_PATH] = { 0 };
                        DWORD size = MAX_PATH;
                        QueryFullProcessImageNameA(hProc, 0, exePath, &size);
                        CloseHandle(hProc);

                        std::string exeClean = CleanAlphaNum(exePath);
                        std::cerr << "[NativeAudio] Session " << i << ": PID " << pid << " -> " << exePath << std::endl;

                        if (exeClean.find(sClean) != std::string::npos || sClean.find(exeClean) != std::string::npos) {
                            std::cerr << "[NativeAudio] Matched target PID: " << pid << " for search: " << searchName << std::endl;
                            return pid;
                        }
                    }
                }
            }
        }
    }
    return 0;
}

int main(int argc, char* argv[]) {
    _setmode(_fileno(stdout), _O_BINARY);
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) return 1;

    DWORD targetPid = 0;
    if (argc >= 2) {
        std::string arg = argv[1];
        if (arg == "-name" && argc >= 3) {
            targetPid = FindActiveAudioPidByName(argv[2]);
        } else if (arg == "-pid" && argc >= 3) {
            targetPid = std::stoul(argv[2]);
        } else {
            try { targetPid = std::stoul(arg); } catch (...) {}
            if (targetPid == 0) targetPid = FindActiveAudioPidByName(arg);
        }
    }

    std::cerr << "[NativeAudio] Initializing capture for PID: " << targetPid << std::endl;
    ComPtr<IAudioClient> audioClient;

    if (targetPid > 0) {
        AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS loopbackParams = {};
        loopbackParams.TargetProcessId = targetPid;
        loopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

        AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
        activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
        activationParams.ProcessLoopbackParams = loopbackParams;

        PROPVARIANT propVariant = {};
        propVariant.vt = VT_BLOB;
        propVariant.blob.cbSize = sizeof(activationParams);
        propVariant.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

        auto handler = Microsoft::WRL::Make<AudioActivationHandler>();
        ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;

        hr = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            __uuidof(IAudioClient),
            &propVariant,
            handler.Get(),
            &asyncOp
        );

        if (SUCCEEDED(hr)) {
            WaitForSingleObject(handler->completionEvent, 4000);
            if (SUCCEEDED(handler->activationResult) && handler->audioClient) {
                audioClient = handler->audioClient;
                std::cerr << "[NativeAudio] Successfully activated process loopback for PID " << targetPid << std::endl;
            } else {
                std::cerr << "[NativeAudio] Activation failed (hr=" << std::hex << handler->activationResult << "), falling back to system loopback" << std::endl;
            }
        }
    }

    if (!audioClient) {
        std::cerr << "[NativeAudio] Using System Default Endpoint Loopback" << std::endl;
        ComPtr<IMMDeviceEnumerator> enumerator;
        if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator)))) {
            ComPtr<IMMDevice> defaultDevice;
            if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice))) {
                defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
            }
        }
    }

    if (!audioClient) {
        std::cerr << "[NativeAudio] Error: Could not obtain IAudioClient" << std::endl;
        return 1;
    }

    WAVEFORMATEX wfx = {};
    wfx.wFormatTag = WAVE_FORMAT_PCM;
    wfx.nChannels = 2;
    wfx.nSamplesPerSec = 48000;
    wfx.wBitsPerSample = 16;
    wfx.nBlockAlign = (wfx.nChannels * wfx.wBitsPerSample) / 8;
    wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;

    REFERENCE_TIME bufferDuration = 1000000;
    hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
        bufferDuration,
        0,
        &wfx,
        nullptr
    );

    if (FAILED(hr)) {
        WAVEFORMATEX* mixFormat = nullptr;
        if (SUCCEEDED(audioClient->GetMixFormat(&mixFormat))) {
            hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, bufferDuration, 0, mixFormat, nullptr);
            CoTaskMemFree(mixFormat);
        }
    }

    if (FAILED(hr)) {
        std::cerr << "[NativeAudio] AudioClient Initialize failed: " << std::hex << hr << std::endl;
        return 1;
    }

    ComPtr<IAudioCaptureClient> captureClient;
    if (FAILED(audioClient->GetService(IID_PPV_ARGS(&captureClient)))) return 1;
    if (FAILED(audioClient->Start())) return 1;

    std::cerr << "[NativeAudio] Capture streaming started! (48kHz 16-bit Stereo)" << std::endl;

    while (true) {
        Sleep(10);
        UINT32 packetLength = 0;
        if (FAILED(captureClient->GetNextPacketSize(&packetLength))) break;

        while (packetLength > 0) {
            BYTE* data = nullptr;
            UINT32 numFramesRead = 0;
            DWORD flags = 0;

            if (SUCCEEDED(captureClient->GetBuffer(&data, &numFramesRead, &flags, nullptr, nullptr)) && numFramesRead > 0) {
                DWORD bytesToWrite = numFramesRead * wfx.nBlockAlign;
                if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                    std::vector<BYTE> silence(bytesToWrite, 0);
                    fwrite(silence.data(), 1, bytesToWrite, stdout);
                } else {
                    fwrite(data, 1, bytesToWrite, stdout);
                }
                fflush(stdout);
                captureClient->ReleaseBuffer(numFramesRead);
            }
            captureClient->GetNextPacketSize(&packetLength);
        }
    }

    audioClient->Stop();
    CoUninitialize();
    return 0;
}
