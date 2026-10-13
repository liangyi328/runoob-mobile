"""
Lean APK build pipeline -- no Gradle, no AGP, no androidx.

Uses only build-tools binaries:
    aapt2  -> compile resources + link manifest/assets into a base apk
    javac  -> compile MainActivity against android.jar
    d8     -> dex the classes
    zipalign + apksigner -> align and sign with a debug keystore

NOTE: aapt2 cannot handle non-ASCII paths on Windows (the project lives under
a Chinese path), so all inputs are staged to an ASCII temp dir first and the
finished APK is copied back.

Prereqs:
    %LOCALAPPDATA%\\Android\\Sdk\\build-tools\\34.0.0\\{aapt2.exe, d8.bat, apksigner.bat, zipalign.exe}
    %LOCALAPPDATA%\\Android\\Sdk\\platforms\\android-34\\android.jar
JDK 17 on PATH provides javac / keytool / the java used by d8 & apksigner.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "android")
MAIN = os.path.join(ANDROID, "app", "src", "main")
OUT_APK_DIR = os.path.join(ANDROID, "app", "build", "outputs", "apk", "debug")

# ASCII-only staging (aapt2 breaks on non-ASCII paths)
STAGE = os.path.join(tempfile.gettempdir(), "runoob-lean")
STAGE_MAIN = os.path.join(STAGE, "main")
BUILD = os.path.join(STAGE, "build")
KEYSTORE = os.path.join(os.environ.get("LOCALAPPDATA", STAGE),
                        "runoob-lean", "debug.keystore")

SDK_CANDIDATES = [
    os.environ.get("ANDROID_HOME"),
    os.environ.get("ANDROID_SDK_ROOT"),
    os.path.join(os.path.expanduser("~"), "AppData", "Local", "Android", "Sdk"),
]
BT_VERSION = "34.0.0"
PLATFORM = "android-34"


def log(m):
    print(m, flush=True)


def die(m):
    log("ERROR: " + m)
    sys.exit(1)


def find_sdk():
    for c in SDK_CANDIDATES:
        if c and os.path.isdir(c):
            return c
    die("Android SDK not found. Install build-tools/platform first.")


def run(cmd):
    log("  $ " + " ".join(os.path.basename(str(c)) for c in cmd))
    # tools emit UTF-8; decode explicitly (system locale is GBK on zh-CN Windows)
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        log((r.stdout or "")[-2000:])
        log((r.stderr or "")[-2000:])
        die(f"step failed ({r.returncode}): {cmd[0]}")
    return r


def main():
    sdk = find_sdk()
    bt = os.path.join(sdk, "build-tools", BT_VERSION)
    android_jar = os.path.join(sdk, "platforms", PLATFORM, "android.jar")
    for p in (os.path.join(bt, "aapt2.exe"), os.path.join(bt, "d8.bat"),
              os.path.join(bt, "apksigner.bat"), os.path.join(bt, "zipalign.exe"),
              android_jar):
        if not os.path.exists(p):
            die(f"missing tool: {p}\nRun sdkmanager: platforms;{PLATFORM} build-tools;{BT_VERSION}")

    # ---- stage inputs to ASCII path ----
    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE_MAIN)
    for item in ("res", "assets", "java", "AndroidManifest.xml"):
        src = os.path.join(MAIN, item)
        if not os.path.exists(src):
            die(f"missing input: {src}")
        dst = os.path.join(STAGE_MAIN, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy(src, dst)

    # raw aapt2 link requires package= in the manifest (Gradle/AGP does not,
    # it uses namespace) -> inject it into the staged copy only
    man = os.path.join(STAGE_MAIN, "AndroidManifest.xml")
    with open(man, encoding="utf-8") as f:
        txt = f.read()
    head = txt.split(">", 1)[0]
    if 'package="' not in head:
        txt = txt.replace(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    package="com.runoob.mobile">', 1)
        with open(man, "w", encoding="utf-8") as f:
            f.write(txt)
    log(f"staged -> {STAGE}")
    os.makedirs(BUILD)
    os.makedirs(OUT_APK_DIR, exist_ok=True)

    # 1. compile resources
    run([os.path.join(bt, "aapt2.exe"), "compile",
         "--dir", os.path.join(STAGE_MAIN, "res"),
         "-o", os.path.join(BUILD, "res.zip")])

    # 2. link -> base apk with manifest + resources + assets
    base_apk = os.path.join(BUILD, "base.apk")
    run([os.path.join(bt, "aapt2.exe"), "link",
         "-o", base_apk,
         "-I", android_jar,
         "--manifest", os.path.join(STAGE_MAIN, "AndroidManifest.xml"),
         "-A", os.path.join(STAGE_MAIN, "assets"),
         "--min-sdk-version", "24",
         "--target-sdk-version", "34",
         "--auto-add-overlay",
         os.path.join(BUILD, "res.zip")])
    log(f"  base apk: {os.path.getsize(base_apk)/1024/1024:.1f} MB")

    # 3. javac
    classes_dir = os.path.join(BUILD, "classes")
    os.makedirs(classes_dir, exist_ok=True)
    java_files = []
    for dirpath, _, files in os.walk(os.path.join(STAGE_MAIN, "java")):
        for f in files:
            if f.endswith(".java"):
                java_files.append(os.path.join(dirpath, f))
    if not java_files:
        die("no java sources found")
    run(["javac", "-encoding", "UTF-8", "-source", "1.8", "-target", "1.8",
         "-bootclasspath", android_jar, "-d", classes_dir] + java_files)

    # 4. d8 -> classes.dex
    dex_out = os.path.join(BUILD, "dex")
    os.makedirs(dex_out, exist_ok=True)
    class_files = []
    for dirpath, _, files in os.walk(classes_dir):
        for f in files:
            if f.endswith(".class"):
                class_files.append(os.path.join(dirpath, f))
    run([os.path.join(bt, "d8.bat"), "--release", "--lib", android_jar,
         "--min-api", "24", "--output", dex_out] + class_files)
    dex_file = os.path.join(dex_out, "classes.dex")
    if not os.path.exists(dex_file):
        die("classes.dex not produced")

    # 5. append classes.dex into the apk
    with_dex = os.path.join(BUILD, "with-dex.apk")
    shutil.copy(base_apk, with_dex)
    with zipfile.ZipFile(with_dex, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(dex_file, "classes.dex")

    # 6. zipalign
    aligned = os.path.join(BUILD, "aligned.apk")
    run([os.path.join(bt, "zipalign.exe"), "-f", "4", with_dex, aligned])

    # 7. keystore (persist at stable ASCII path so reinstalls keep the signature)
    os.makedirs(os.path.dirname(KEYSTORE), exist_ok=True)
    if not os.path.exists(KEYSTORE):
        log("  generating debug keystore...")
        run(["keytool", "-genkeypair", "-alias", "androiddebugkey",
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-keystore", KEYSTORE, "-storepass", "android",
             "-keypass", "android",
             "-dname", "CN=Android Debug,O=Android,C=US"])

    # 8. sign
    out_apk = os.path.join(OUT_APK_DIR, "runoob-mobile-debug.apk")
    run([os.path.join(bt, "apksigner.bat"), "sign",
         "--ks", KEYSTORE, "--ks-pass", "pass:android",
         "--key-pass", "pass:android", "--out", out_apk, aligned])

    # 9. verify
    run([os.path.join(bt, "apksigner.bat"), "verify", "--print-certs", out_apk])
    size_mb = os.path.getsize(out_apk) / 1024 / 1024
    log("")
    log(f"DONE: {out_apk}")
    log(f"size: {size_mb:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
