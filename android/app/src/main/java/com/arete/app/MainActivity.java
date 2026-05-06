package com.arete.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setTextZoom(100);
            webView.getSettings().setUseWideViewPort(true);
        }
    }
}
