package com.threeland.capacitor.walletextension;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class WalletExtensionRedirectActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Uri callbackUri = getIntent() != null ? getIntent().getData() : null;
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());

        if (launchIntent != null && callbackUri != null) {
            launchIntent.setAction(Intent.ACTION_VIEW);
            launchIntent.setData(callbackUri);
            launchIntent.addFlags(
                Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_NEW_TASK
            );
            startActivity(launchIntent);
        }

        finish();
    }
}
