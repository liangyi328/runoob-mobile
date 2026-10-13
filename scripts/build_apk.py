"""
构建 Android APK —— 把 app/ 里的 PWA 打包成原生壳。

原理：Capacitor 把 Web 资源放进 Android 工程的 assets/public/，
用 WebView 加载本地 index.html，得到一个真正可安装的 .apk。

前置：需要 Android SDK（命令行工具即可，无需 Android Studio）。
本脚本会：
  1. 检查 Java / Android SDK
  2. 生成 Gradle 工程（settings.gradle / build.gradle / AndroidManifest / MainActivity）
  3. 复制 Web 资源到 assets/public/
  4. 调用 gradlew 构建

用法：
    python scripts/build_apk.py            # 构建 debug APK
    python scripts/build_apk.py --release  # 构建 release APK（需签名配置）
    python scripts/build_apk.py --sdk-only # 只生成工程，不构建
"""
import argparse
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "app")
ANDROID_DIR = os.path.join(ROOT, "android")

PACKAGE = "com.runoob.mobile"
APP_NAME = "菜鸟教程"
VERSION_CODE = 1
VERSION_NAME = "1.0.0"
MIN_SDK = 24          # Android 7.0+
TARGET_SDK = 34       # Android 14
COMPILE_SDK = 34

SETTINGS_GRADLE = """pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "runoob-mobile"
include ':app'
"""

ROOT_BUILD_GRADLE = """// 顶层构建文件
buildscript {
    repositories { google(); mavenCentral() }
}
plugins {
    id 'com.android.application' version '8.1.4' apply false
}
task clean(type: Delete) { delete rootProject.buildDir }
"""

APP_BUILD_GRADLE = f"""plugins {{ id 'com.android.application' }}

android {{
    namespace "{PACKAGE}"
    compileSdk {COMPILE_SDK}

    defaultConfig {{
        applicationId "{PACKAGE}"
        minSdk {MIN_SDK}
        targetSdk {TARGET_SDK}
        versionCode {VERSION_CODE}
        versionName "{VERSION_NAME}"
    }}

    // Web 资源不压缩，WebView 直接读取
    aaptOptions {{
        noCompress "html", "css", "js", "json", "webmanifest", "png"
    }}

    buildTypes {{
        release {{
            minifyEnabled false
            // 使用 debug 签名，方便本机安装验证
            signingConfig signingConfigs.debug
        }}
    }}

    compileOptions {{
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }}
}}

dependencies {{
    implementation 'androidx.appcompat:appcompat:1.6.1'
    implementation 'androidx.webkit:webkit:1.8.0'
    implementation 'androidx.core:core:1.12.0'
}}
"""

MANIFEST = f"""<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="{APP_NAME}"
        android:roundIcon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:usesCleartextTraffic="false"
        android:hardwareAccelerated="true"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|uiMode|screenLayout|smallestScreenSize"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""

MAIN_ACTIVITY = f"""package {PACKAGE};

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * 原生壳：用 WebView 加载 assets/public/index.html。
 * 通过 WebViewAssetLoader 以 https://appassets.androidplatform.net/ 提供本地资源，
 * 这样 Service Worker 才能正常工作（file:// 下 SW 不可用）。
 */
public class MainActivity extends AppCompatActivity {{

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {{
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {{
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,
                    android.webkit.WebResourceRequest request) {{
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }}
        }});
        webView.setWebChromeClient(new WebChromeClient());

        setContentView(webView);
        webView.loadUrl("https://appassets.androidplatform.net/assets/public/index.html");
        setTitle("{APP_NAME}");
    }}

    /** 让 WebView 内的 history.pushState 路由可被返回键导航 */
    @Override
    public void onBackPressed() {{
        if (webView != null && webView.canGoBack()) {{
            webView.goBack();
        }} else {{
            super.onBackPressed();
        }}
    }}
}}
"""

STYLES_XML = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="colorPrimary">#0E7A5F</item>
        <item name="colorPrimaryDark">#0A5C48</item>
        <item name="colorAccent">#0E7A5F</item>
        <item name="android:windowNoTitle">true</item>
    </style>
</resources>
"""

STRINGS_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">{APP_NAME}</string>
</resources>
"""

GRADLE_PROPS = """org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.enableJetifier=true
org.gradle.daemon=false
"""


def log(msg):
    print(msg, flush=True)


def find_sdk():
    """定位 Android SDK。"""
    env = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if env and os.path.isdir(env):
        return env
    local = os.path.join(os.path.expanduser("~"), "AppData", "Local", "Android", "Sdk")
    if os.path.isdir(local):
        return local
    return None


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def gen_project():
    """生成 Android Gradle 工程骨架。"""
    log("[1/3] 生成 Android 工程 …")
    base = os.path.join(ANDROID_DIR, "app", "src", "main")
    java_pkg = os.path.join(base, "java", *PACKAGE.split("."))
    res = os.path.join(base, "res")

    write(os.path.join(ANDROID_DIR, "settings.gradle"), SETTINGS_GRADLE)
    write(os.path.join(ANDROID_DIR, "build.gradle"), ROOT_BUILD_GRADLE)
    write(os.path.join(ANDROID_DIR, "gradle.properties"), GRADLE_PROPS)
    write(os.path.join(ANDROID_DIR, "app", "build.gradle"), APP_BUILD_GRADLE)
    write(os.path.join(base, "AndroidManifest.xml"), MANIFEST)
    write(os.path.join(java_pkg, "MainActivity.java"), MAIN_ACTIVITY)
    write(os.path.join(res, "values", "styles.xml"), STYLES_XML)
    write(os.path.join(res, "values", "strings.xml"), STRINGS_XML)
    log("      ✓ 工程骨架完成")


def copy_web_assets():
    """复制 Web 资源到 assets/public/。"""
    log("[2/3] 复制 Web 资源 …")
    dst = os.path.join(ANDROID_DIR, "app", "src", "main", "assets", "public")
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(APP_DIR, dst)

    # 生成 mipmap 图标
    icons = os.path.join(APP_DIR, "icons")
    for density, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                          ("xxhdpi", 144), ("xxxhdpi", 192)):
        d = os.path.join(ANDROID_DIR, "app", "src", "main", "res", f"mipmap-{density}")
        os.makedirs(d, exist_ok=True)
        src = os.path.join(icons, "icon-512.png")
        if os.path.exists(src):
            shutil.copy(src, os.path.join(d, "ic_launcher.png"))
    log(f"      ✓ 资源已复制 -> {os.path.relpath(dst, ROOT)}")


def run_gradle(release=False):
    """调用 gradle 构建。"""
    log("[3/3] 构建 APK（首次会下载依赖，请耐心等待）…")
    sdk = find_sdk()
    if not sdk:
        log("\n✗ 未找到 Android SDK。")
        log("  请先安装 Android 命令行工具，然后设置环境变量：")
        log("    setx ANDROID_HOME \"%LOCALAPPDATA%\\Android\\Sdk\"")
        log("  或运行 scripts/install_android_sdk.ps1 自动安装。")
        return 1
    os.environ["ANDROID_HOME"] = sdk
    os.environ["ANDROID_SDK_ROOT"] = sdk

    gradlew = os.path.join(ANDROID_DIR, "gradlew.bat" if os.name == "nt" else "gradlew")
    if not os.path.exists(gradlew):
        log("  ! 未找到 gradlew，尝试用系统 gradle …")
        gradlew = shutil.which("gradle")
        if not gradlew:
            log("  ✗ 未找到 gradle。工程已生成，请在 Android Studio 中打开构建。")
            return 1

    task = "assembleRelease" if release else "assembleDebug"
    cmd = [gradlew, "-p", ANDROID_DIR, task, "--no-daemon"]
    log("  $ " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=ANDROID_DIR)
    if r.returncode != 0:
        log("  ✗ 构建失败，请查看上方错误。")
        return r.returncode

    apk_dir = os.path.join(ANDROID_DIR, "app", "build", "outputs", "apk",
                           "release" if release else "debug")
    for f in os.listdir(apk_dir):
        if f.endswith(".apk"):
            p = os.path.join(apk_dir, f)
            log(f"\n✓ APK 生成成功：{p}  ({os.path.getsize(p)/1024/1024:.1f} MB)")
            log("  安装到手机：adb install -r \"" + p + "\"")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", action="store_true", help="构建 release 版本")
    ap.add_argument("--sdk-only", action="store_true", help="只生成工程不构建")
    args = ap.parse_args()

    if not os.path.isdir(APP_DIR):
        log(f"✗ 找不到应用目录 {APP_DIR}")
        return 1

    gen_project()
    copy_web_assets()
    if args.sdk_only:
        log("\n✓ 工程已生成于 android/（未构建）")
        return 0
    return run_gradle(args.release)


if __name__ == "__main__":
    sys.exit(main())
