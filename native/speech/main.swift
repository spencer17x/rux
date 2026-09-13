import Foundation
import Speech

func finish(_ value: [String: Any], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(code)
}

let args = CommandLine.arguments
let locale = Locale(identifier: args.count > 2 ? args[2] : "zh-CN")
guard let recognizer = SFSpeechRecognizer(locale: locale) else { finish(["error": "macOS 不支持此识别语言"], code: 1) }
let authorization = SFSpeechRecognizer.authorizationStatus()
if args.count > 1 && args[1] == "--status" {
    let names: [SFSpeechRecognizerAuthorizationStatus: String] = [.notDetermined: "not-determined", .denied: "denied", .restricted: "restricted", .authorized: "authorized"]
    finish(["available": true, "permission": names[authorization] ?? "restricted", "onDevice": recognizer.supportsOnDeviceRecognition])
}
if args.count > 1 && args[1] == "--authorize" {
    SFSpeechRecognizer.requestAuthorization { status in
        if status == .authorized { finish(["authorized": true]) }
        finish(["error": "请在系统设置 → 隐私与安全性 → 语音识别中允许 Rux"], code: 1)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 90) { finish(["error": "语音识别授权超时，请重试"], code: 1) }
    RunLoop.main.run()
    exit(1)
}
guard args.count > 1 else { finish(["error": "缺少录音文件"], code: 1) }
var task: SFSpeechRecognitionTask?
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard status == .authorized else { finish(["error": "请在系统设置 → 隐私与安全性 → 语音识别中允许 Rux"], code: 1) }
        guard recognizer.isAvailable else { finish(["error": "系统语音服务暂不可用，请检查网络或系统语音设置后重试"], code: 1) }
        let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: args[1]))
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        task = recognizer.recognitionTask(with: request) { result, error in
            if let result = result, result.isFinal { finish(["text": result.bestTranscription.formattedString, "onDevice": request.requiresOnDeviceRecognition]) }
            if let error = error { finish(["error": "语音转写失败：\(error.localizedDescription)"], code: 1) }
        }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 90) { task?.cancel(); finish(["error": "语音转写超时，请重试"], code: 1) }
RunLoop.main.run()
