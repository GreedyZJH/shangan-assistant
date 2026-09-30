package com.ruzhichaolu.shangan;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private JsBridge jsBridge;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (bridge != null && bridge.getWebView() != null) {
      jsBridge = new JsBridge(this, bridge.getWebView());
      bridge.getWebView().addJavascriptInterface(jsBridge, "AndroidBridge");
    }
  }

  @Override
  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (jsBridge != null) jsBridge.handleLoginResult(requestCode, resultCode, data);
  }
}
