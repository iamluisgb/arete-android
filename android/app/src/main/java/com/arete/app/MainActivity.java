package com.arete.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.plugin.statusbar.StatusBar;
import com.getcapacitor.plugin.haptics.Haptics;
import com.getcapacitor.plugin.splashscreen.SplashScreen;
import com.getcapacitor.plugin.network.Network;
import com.getcapacitor.plugin.app.App;
import com.getcapacitor.plugin.keyboard.Keyboard;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(StatusBar.class);
        registerPlugin(Haptics.class);
        registerPlugin(SplashScreen.class);
        registerPlugin(Network.class);
        registerPlugin(App.class);
        registerPlugin(Keyboard.class);
    }
}
