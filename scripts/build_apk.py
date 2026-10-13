"""
Generate the Android project skeleton for the runoob-mobile offline PWA.

The app is a SELF-CONTAINED WebView shell: all web assets (183 tutorial
chapters) are copied into app/src/main/assets/public/ and served over an
https origin (appassets.androidplatform.net) so the service worker works.
No androidx / appcompat dependencies -> buildable with just aapt2+javac+d8.

Usage:
    python scripts/build_apk.py            # generate project (assets synced)
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "app")
ANDROID_DIR = os.path.join(ROOT, "android")

PACKAGE = "com.runoob.mobile"
APP_NAME = "菜鸟教程"
VERSION_CODE = 1
VERSION_NAME = "1.0.0"
MIN_SDK = 24
TARGET_SDK = 34
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

ROOT_BUILD_GRADLE = """plugins {
    id 'com.android.application' version '8.1.4' apply false
}
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

    buildTypes {{
        release {{
            minifyEnabled false
            signingConfig signingConfigs.debug
        }}
    }}

    compileOptions {{
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }}
}}

// No dependencies on purpose: the shell uses only platform APIs,
// which keeps the build possible with aapt2 + javac + d8 alone.
"""

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Internet only for tutorial images (kept as remote links by choice);
         all text/code content is bundled locally. -->
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
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

MAIN_ACTIVITY = """package com.runoob.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Self-contained offline shell: loads index.html from bundled assets over an
 * https origin so the service worker can register. No network needed for
 * text/code content; tutorial images load only when online.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String PREFIX = "/assets/";

    private WebView webView;

    private static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html");
        MIME.put("css", "text/css");
        MIME.put("js", "application/javascript");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                    WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }
        });

        setContentView(webView);
        webView.loadUrl("https://" + HOST + PREFIX + "public/index.html");
    }

    private WebResourceResponse serveAsset(android.net.Uri url) {
        if (url == null || !HOST.equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || !path.startsWith(PREFIX)) return null;
        String assetPath = path.substring(PREFIX.length());
        if (assetPath.isEmpty()) assetPath = "public/index.html";
        try {
            InputStream is = getAssets().open(assetPath);
            String ext = "";
            int dot = assetPath.lastIndexOf('.');
            if (dot >= 0) ext = assetPath.substring(dot + 1).toLowerCase();
            String mime = MIME.get(ext);
            if (mime == null) mime = "application/octet-stream";
            String enc = null;
            if (mime.startsWith("text/") || mime.contains("javascript")
                    || mime.contains("json") || mime.contains("manifest")) {
                enc = "utf-8";
            }
            WebResourceResponse resp = new WebResourceResponse(mime, enc, is);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Access-Control-Allow-Origin", "*");
            resp.setResponseHeaders(headers);
            return resp;
        } catch (IOException e) {
            return null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
"""

STYLES_XML = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="@android:style/Theme.Material.Light.NoActionBar">
        <item name="android:statusBarColor">#0E7A5F</item>
        <item name="android:windowBackground">#FFFFFF</item>
    </style>
</resources>
"""

STRINGS_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">{APP_NAME}</string>
</resources>
"""

GRADLE_PROPS = """org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=false
org.gradle.daemon=false
"""


def log(msg):
    print(msg, flush=True)


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


def gen_project():
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
    log("  [ok] project skeleton")


def copy_web_assets():
    dst = os.path.join(ANDROID_DIR, "app", "src", "main", "assets", "public")
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(APP_DIR, dst)

    icons = os.path.join(APP_DIR, "icons")
    src_icon = os.path.join(icons, "icon-512.png")
    for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        d = os.path.join(ANDROID_DIR, "app", "src", "main", "res", f"mipmap-{density}")
        os.makedirs(d, exist_ok=True)
        if os.path.exists(src_icon):
            shutil.copy(src_icon, os.path.join(d, "ic_launcher.png"))
    log(f"  [ok] web assets -> {os.path.relpath(dst, ROOT)}")


def main():
    if not os.path.isdir(APP_DIR):
        log(f"ERROR: app dir not found: {APP_DIR}")
        return 1
    log("[1/2] generating Android project...")
    gen_project()
    log("[2/2] copying web assets...")
    copy_web_assets()
    log(f"\nProject ready at {ANDROID_DIR}")
    log("Build with: python scripts/build_apk_lean.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
