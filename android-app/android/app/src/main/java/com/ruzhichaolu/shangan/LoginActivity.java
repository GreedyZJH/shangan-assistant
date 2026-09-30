package com.ruzhichaolu.shangan;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.HashMap;
import java.util.Map;

/**
 * 粉笔官方登录页（WebView）。后台轮询原生 CookieManager（可读 HttpOnly），
 * 检测到网页登录态（userid + sess/persistent）后自动把整段 Cookie 回传给主页面，
 * 由前端 whoami 真实验证——判定口径与桌面版一致。
 */
public class LoginActivity extends Activity {
  public static final String EXTRA_RESULT = "cookie";
  private static final String LOGIN_URL = "https://www.fenbi.com/page/home";
  private static final long POLL_MS = 1500;

  private static LoginActivity current;

  private WebView web;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private boolean done = false;
  private int confirmRounds = 0;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    current = this;
    web = new WebView(this);
    setContentView(web);
    WebSettings st = web.getSettings();
    st.setJavaScriptEnabled(true);
    st.setDomStorageEnabled(true);
    web.setWebViewClient(new WebViewClient());
    web.loadUrl(LOGIN_URL);
    handler.postDelayed(poll, 3000);
  }

  private final Runnable poll = new Runnable() {
    @Override public void run() {
      if (done || isFinishing() || current != LoginActivity.this) return;
      Map<String, String> pairs = parse(currentCookie());
      String userid = pairs.get("userid");
      boolean hasSess = pairs.containsKey("sess") || pairs.containsKey("persistent");
      if (userid != null && !userid.isEmpty() && hasSess) {
        /* 多确认一轮：等服务端补发会话 Cookie（通常几秒内完成） */
        if (confirmRounds < 1) {
          confirmRounds += 1;
        } else {
          done = true;
          Intent i = new Intent();
          i.putExtra(EXTRA_RESULT, currentCookie());
          setResult(RESULT_OK, i);
          finish();
          return;
        }
      } else {
        confirmRounds = 0;
      }
      handler.postDelayed(this, POLL_MS);
    }
  };

  /** 合并两个粉笔域名的 Cookie（等价请求头 Cookie 字段，含 HttpOnly）。 */
  public static String currentCookie() {
    try {
      CookieManager cm = CookieManager.getInstance();
      String a = cm.getCookie("https://www.fenbi.com");
      String b = cm.getCookie("https://login.fenbi.com");
      StringBuilder sb = new StringBuilder();
      if (a != null && a.length() > 0) sb.append(a);
      if (b != null && b.length() > 0) {
        if (sb.length() > 0) sb.append("; ");
        sb.append(b);
      }
      return sb.toString();
    } catch (Exception e) {
      return "";
    }
  }

  public static void closeIfOpen() {
    LoginActivity c = current;
    if (c != null && !c.isFinishing()) {
      c.done = true;
      c.finish();
    }
  }

  private static Map<String, String> parse(String raw) {
    Map<String, String> out = new HashMap<String, String>();
    if (raw == null) return out;
    for (String chunk : raw.split(";")) {
      chunk = chunk.trim();
      int i = chunk.indexOf("=");
      if (chunk.isEmpty() || i < 0) continue;
      out.put(chunk.substring(0, i).trim(), chunk.substring(i + 1).trim());
    }
    return out;
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) {
      web.goBack();
    } else {
      done = true;
      setResult(RESULT_CANCELED);
      finish();
    }
  }

  @Override
  protected void onDestroy() {
    if (current == this) current = null;
    handler.removeCallbacksAndMessages(null);
    super.onDestroy();
  }
}
