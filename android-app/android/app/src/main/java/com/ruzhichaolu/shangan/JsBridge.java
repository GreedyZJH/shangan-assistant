package com.ruzhichaolu.shangan;

import android.app.Activity;
import android.content.Intent;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * 暴露给前端 window.AndroidBridge 的原生桥：
 * openLogin() 打开粉笔登录页（独立 Activity），
 * 登录成功/取消后回调 window.__androidLoginResult / window.__androidLoginClosed。
 */
public class JsBridge {
  private static final int REQ_LOGIN = 1001;

  private final Activity activity;
  private final WebView webView;

  public JsBridge(Activity activity, WebView webView) {
    this.activity = activity;
    this.webView = webView;
  }

  @JavascriptInterface
  public void openLogin() {
    activity.runOnUiThread(new Runnable() {
      @Override public void run() {
        try {
          activity.startActivityForResult(new Intent(activity, LoginActivity.class), REQ_LOGIN);
        } catch (Exception ignored) {}
      }
    });
  }

  @JavascriptInterface
  public void closeLogin() {
    activity.runOnUiThread(new Runnable() {
      @Override public void run() { LoginActivity.closeIfOpen(); }
    });
  }

  /** 同步读取当前原生 CookieManager 里的粉笔 Cookie（含 HttpOnly）。 */
  @JavascriptInterface
  public String getLoginCookie() {
    return LoginActivity.currentCookie();
  }

  @JavascriptInterface
  public void clearFenbiCookies() {
    activity.runOnUiThread(new Runnable() {
      @Override public void run() {
        try {
          CookieManager cm = CookieManager.getInstance();
          cm.removeAllCookies(null);
          cm.flush();
        } catch (Exception ignored) {}
      }
    });
  }

  void handleLoginResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != REQ_LOGIN) return;
    final String cookie = (resultCode == Activity.RESULT_OK && data != null)
        ? data.getStringExtra(LoginActivity.EXTRA_RESULT) : null;
    final String js = cookie != null
        ? "window.__androidLoginResult(" + JSONObject.quote(cookie) + ")"
        : "window.__androidLoginClosed()";
    activity.runOnUiThread(new Runnable() {
      @Override public void run() {
        if (webView == null) return;
        webView.post(new Runnable() {
          @Override public void run() { webView.evaluateJavascript(js, null); }
        });
      }
    });
  }
}
