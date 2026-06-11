// jp-tts — local macOS Japanese text-to-speech generator (audio only).
//
// Renders Japanese text to AAC .m4a files using AVSpeechSynthesizer (Apple's on-device
// Japanese voices, e.g. Kyoko) — no network, no API cost, far better than browser
// speechSynthesis. Used to PRE-GENERATE audio for study-app text that has no native
// recording (leveled example sentences, vocab readings, Minna grammar/example lines);
// the Bun driver (generate-tts.ts) uploads the results into our storage layer so
// /v1/tts serves them instead of hitting Google.
//
// AVSpeechSynthesizer can only PLAY directly; to capture audio we use `write(_:)`, which
// streams PCM buffers we accumulate into a temp CAF, then afconvert → AAC m4a (afconvert
// is built in; no ffmpeg/lame needed). One process synthesizes a whole batch so the synth
// + voice load once.
//
// Build:  swiftc -O scripts/jp-tts.swift -o scripts/jp-tts
// Run:    ./scripts/jp-tts --batch manifest.json [--voice Kyoko] [--rate 0.5]
//   manifest.json = [{ "text": "…", "out": "/abs/path.m4a" }, …]
//   Skips items whose `out` already exists (idempotent re-runs). Prints one JSON line
//   per item to stdout: {"out":…,"ok":true|false,"skipped":bool}.

import AVFoundation
import Foundation

struct Item: Decodable { let text: String; let out: String }

func parseArg(_ name: String) -> String? {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: name), i + 1 < a.count { return a[i + 1] }
    return nil
}

func hasFlag(_ name: String) -> Bool { CommandLine.arguments.contains(name) }
func qualityName(_ q: AVSpeechSynthesisVoiceQuality) -> String {
    switch q { case .premium: return "premium"; case .enhanced: return "enhanced"; default: return "default" }
}

let jaVoices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "ja-JP" }

// `--list` — print every installed ja-JP voice (highest quality first) so you can see
// which quality tiers are downloaded and pass an explicit --voice / --voice-id.
// The compact ("default") voices are robotic; enhanced/premium (neural) sound far better
// but must be downloaded in System Settings → Accessibility → Spoken Content →
// System Voice → Manage Voices → Japanese.
if hasFlag("--list") {
    for v in jaVoices.sorted(by: { $0.quality.rawValue > $1.quality.rawValue }) {
        print("\(v.name)\t\(qualityName(v.quality))\t\(v.identifier)")
    }
    exit(0)
}

guard let batchPath = parseArg("--batch"),
      let data = FileManager.default.contents(atPath: batchPath),
      let items = try? JSONDecoder().decode([Item].self, from: data) else {
    FileHandle.standardError.write(Data("jp-tts: --batch <manifest.json> required (or --list)\n".utf8))
    exit(2)
}

let rate = Float(parseArg("--rate") ?? "") ?? AVSpeechUtteranceDefaultSpeechRate
// Voice selection, best-first: an explicit --voice-id wins; else the requested --voice
// NAME (default Kyoko), picking the HIGHEST-QUALITY entry with that name (a name like
// "Kyoko" can have compact + enhanced + premium variants and the compact one sorts first,
// so naively taking `.first` gave the robotic voice even when a better one was installed);
// else the highest-quality ja voice of any name. quality: premium > enhanced > default.
let voiceId = parseArg("--voice-id")
let voiceName = parseArg("--voice") ?? "Kyoko"
let byQuality = { (a: AVSpeechSynthesisVoice, b: AVSpeechSynthesisVoice) in a.quality.rawValue < b.quality.rawValue }
// Match the base name: the enhanced/premium variants are named "Kyoko (Enhanced)" /
// "Kyoko (Premium)", so a plain `name == "Kyoko"` would only ever hit the COMPACT voice
// and we'd synthesize robotic audio even with a better variant installed.
func matchesName(_ v: AVSpeechSynthesisVoice) -> Bool { v.name == voiceName || v.name.hasPrefix(voiceName + " (") }
let voice = (voiceId.flatMap { id in jaVoices.first { $0.identifier == id } })
    ?? jaVoices.filter(matchesName).max(by: byQuality)
    ?? jaVoices.max(by: byQuality)
if voice == nil {
    FileHandle.standardError.write(Data("jp-tts: no ja-JP voice installed\n".utf8))
    exit(3)
}

// Synthesize one utterance to a temp CAF, then afconvert → AAC m4a at `out`.
func synth(_ text: String, to out: String) -> Bool {
    let synth = AVSpeechSynthesizer()
    let utt = AVSpeechUtterance(string: text)
    utt.voice = voice
    utt.rate = rate

    let tmp = NSTemporaryDirectory() + UUID().uuidString + ".caf"
    var file: AVAudioFile?
    var failed = false

    // `write` streams PCM buffers via the run loop; the final buffer has frameLength 0.
    // We must NOT block the thread on a semaphore — that starves the run loop the callback
    // is delivered on (deadlock). Instead run the run loop and stop it from the callback.
    synth.write(utt) { buffer in
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        if pcm.frameLength == 0 { CFRunLoopStop(CFRunLoopGetMain()); return }   // done
        if file == nil {
            do { file = try AVAudioFile(forWriting: URL(fileURLWithPath: tmp), settings: pcm.format.settings) }
            catch { failed = true; CFRunLoopStop(CFRunLoopGetMain()); return }
        }
        do { try file?.write(from: pcm) } catch { failed = true }
    }
    CFRunLoopRun()   // blocks until the callback above stops it
    file = nil   // flush/close the CAF
    defer { try? FileManager.default.removeItem(atPath: tmp) }
    if failed || !FileManager.default.fileExists(atPath: tmp) { return false }

    // Ensure the output directory exists.
    let outURL = URL(fileURLWithPath: out)
    try? FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)

    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/afconvert")
    p.arguments = ["-f", "m4af", "-d", "aac", "-q", "127", "-s", "3", tmp, out]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return false }
    p.waitUntilExit()
    return p.terminationStatus == 0
}

var okCount = 0, failCount = 0, skipCount = 0
for item in items {
    if FileManager.default.fileExists(atPath: item.out) {
        skipCount += 1
        print("{\"out\":\(jsonString(item.out)),\"ok\":true,\"skipped\":true}")
        continue
    }
    let ok = synth(item.text, to: item.out)
    if ok { okCount += 1 } else { failCount += 1 }
    print("{\"out\":\(jsonString(item.out)),\"ok\":\(ok),\"skipped\":false}")
}

FileHandle.standardError.write(Data("jp-tts: \(okCount) generated, \(skipCount) skipped, \(failCount) failed (voice=\(voice!.name) [\(qualityName(voice!.quality))], rate=\(rate))\n".utf8))
exit(failCount > 0 ? 1 : 0)

// Minimal JSON string encoder for stdout lines (paths are ASCII-ish but be safe).
func jsonString(_ s: String) -> String {
    if let d = try? JSONEncoder().encode(s), let str = String(data: d, encoding: .utf8) { return str }
    return "\"\""
}
