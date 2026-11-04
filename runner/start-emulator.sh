#!/usr/bin/env bash
# Boot a headless Android emulator on a GitHub ubuntu runner (KVM must already be enabled). Exit 75 on failure.
set -uo pipefail
API="${1:-34}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager"; AVDM="$SDK/cmdline-tools/latest/bin/avdmanager"
IMG="system-images;android-${API};google_apis;x86_64"
export PATH="$SDK/emulator:$SDK/platform-tools:$PATH"
[ -e /dev/kvm ] || { echo "no /dev/kvm"; exit 75; }
yes | "$SDKM" --licenses >/dev/null 2>&1 || true
"$SDKM" --install "$IMG" "emulator" "platform-tools" >/dev/null || { echo "sdkmanager failed"; exit 75; }
echo no | "$AVDM" create avd -n qaf -k "$IMG" -d pixel_6 --force >/dev/null || { echo "avdmanager failed"; exit 75; }
printf 'hw.ramSize=3072\ndisk.dataPartition.size=4096M\n' >>"$HOME/.android/avd/qaf.avd/config.ini"
setsid nohup emulator -avd qaf -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim -no-snapshot \
  -camera-back none -camera-front none -accel on >"${QAF_META:-/tmp}/emulator-process.log" 2>&1 &
adb start-server >/dev/null
timeout 120 adb wait-for-device || { echo "device never appeared"; exit 75; }
for _ in $(seq 1 300); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] || { echo "boot timeout"; exit 75; }
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell input keyevent 82 || true
echo "emulator API $API booted"
