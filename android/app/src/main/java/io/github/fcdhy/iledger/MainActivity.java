package io.github.fcdhy.iledger;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * 把「隐形账本」这个纯静态网页装进 WebView：
 * 页面全部打包在 assets/web 下，不联网也能用，数据存在 WebView 的 localStorage。
 *
 * 另外挂一个 AndroidVoice 桥：WebView 不支持 Web Speech API，
 * 语音输入改用系统 SpeechRecognizer，识别结果回填到网页输入框。
 */
public class MainActivity extends Activity {

    private static final int REQ_AUDIO = 3001;
    private static final int CREAM = 0xFFFCF8F4;
    /** 与网页 body 背景一致，避免启动时闪白 */
    private static final String BG = "#FCF8F4";

    private WebView web;
    private SpeechRecognizer recognizer;
    private boolean pendingVoiceStart = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(CREAM);
            getWindow().setNavigationBarColor(CREAM);
        }
        // 浅色底 + 深色图标，状态栏才不会糊成一片
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            View decor = getWindow().getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            decor.setSystemUiVisibility(flags);
        }

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor(BG));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        }

        web.addJavascriptInterface(new VoiceBridge(), "AndroidVoice");
        web.setWebViewClient(new WebViewClient());
        setContentView(web);

        if (savedInstanceState == null) {
            web.loadUrl("file:///android_asset/web/index.html");
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    /* ---------------- 语音桥 ---------------- */

    public class VoiceBridge {
        @JavascriptInterface
        public void start() {
            runOnUiThread(MainActivity.this::startVoice);
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(MainActivity.this::stopVoice);
        }
    }

    private void startVoice() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingVoiceStart = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emitError("设备上没有语音识别服务");
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            emitError("语音识别无法启动");
        }
    }

    private void stopVoice() {
        if (recognizer != null) {
            try {
                recognizer.stopListening();
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_AUDIO) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok && pendingVoiceStart) {
                pendingVoiceStart = false;
                startVoice();
            } else {
                pendingVoiceStart = false;
                emitError("没有麦克风权限");
            }
        }
    }

    private class Listener implements RecognitionListener {
        @Override
        public void onPartialResults(Bundle partialResults) {
            String text = first(partialResults, SpeechRecognizer.RESULTS_RECOGNITION);
            if (text != null && !text.isEmpty()) emitResult(text, false);
        }

        @Override
        public void onResults(Bundle results) {
            String text = first(results, SpeechRecognizer.RESULTS_RECOGNITION);
            emitResult(text == null ? "" : text, true);
        }

        @Override
        public void onError(int error) {
            emitError(errorText(error));
        }

        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }
    }

    private String first(Bundle bundle, String key) {
        if (bundle == null) return null;
        ArrayList<String> list = bundle.getStringArrayList(key);
        return (list == null || list.isEmpty()) ? null : list.get(0);
    }

    private String errorText(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "录音出错";
            case SpeechRecognizer.ERROR_CLIENT: return "客户端错误";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "没有麦克风权限";
            case SpeechRecognizer.ERROR_NETWORK: return "网络不可用";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "网络超时";
            case SpeechRecognizer.ERROR_NO_MATCH: return "没听清，再说一次";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "识别器忙";
            case SpeechRecognizer.ERROR_SERVER: return "识别服务出错";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "没有检测到说话";
            default: return "识别中断（" + error + "）";
        }
    }

    private void emitResult(String text, boolean isFinal) {
        String js = "window.__nativeVoiceResult&&window.__nativeVoiceResult("
                + JSONObject.quote(text) + "," + isFinal + ")";
        web.evaluateJavascript(js, null);
    }

    private void emitError(String message) {
        String js = "window.__nativeVoiceError&&window.__nativeVoiceError("
                + JSONObject.quote(message) + ")";
        web.evaluateJavascript(js, null);
    }

    /* ---------------- 生命周期 ---------------- */

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {
            }
            recognizer = null;
        }
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
