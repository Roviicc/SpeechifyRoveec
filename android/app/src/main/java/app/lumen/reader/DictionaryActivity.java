package app.lumen.reader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Invisible helper started by the Lumen web app:
 *   lumen://lookup?q=word  → open the chosen dictionary app with the word, as a popup where the app supports it
 *   lumen://choose         → pick the dictionary app from the apps installed on this phone
 *
 * Two ways to talk to a dictionary:
 *   - ColorDict API (action colordict.intent.action.SEARCH, used by Moon+ Reader; also GoldenDict, Fora, …):
 *     EXTRA_FULLSCREEN=false makes it a floating window over the book.
 *   - Android's "process text" action (the apps listed in the text-selection menu, e.g. Google Translate's popup).
 */
public class DictionaryActivity extends Activity {
    private static final String COLORDICT_SEARCH = "colordict.intent.action.SEARCH";
    private static final String PREFS = "lumen";
    private static final String KEY_PKG = "dictPackage";
    private static final String KEY_CLS = "dictClass";
    private static final String KEY_KIND = "dictKind"; // "colordict" | "process_text"

    /** A dictionary app the user can choose. */
    private static final class DictApp {
        final String pkg;
        final String cls;
        final String kind;
        final String label;

        DictApp(String pkg, String cls, String kind, String label) {
            this.pkg = pkg;
            this.cls = cls;
            this.kind = kind;
            this.label = label;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        String action = data == null ? "" : String.valueOf(data.getHost());
        String query = data == null ? null : data.getQueryParameter("q");

        if ("choose".equals(action)) {
            choose(null);
        } else if ("lookup".equals(action) && query != null && !query.trim().isEmpty()) {
            lookup(query.trim());
        } else {
            finish();
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void lookup(String query) {
        SharedPreferences p = prefs();
        String pkg = p.getString(KEY_PKG, null);
        if (pkg == null) {
            choose(query); // first time: ask which app, then look up
            return;
        }
        DictApp app = new DictApp(pkg, p.getString(KEY_CLS, null), p.getString(KEY_KIND, "process_text"), "");
        if (!open(app, query)) {
            p.edit().clear().apply(); // app was uninstalled: ask again
            choose(query);
            return;
        }
        finish();
    }

    /** Start the dictionary. Returns false if the app is gone. */
    private boolean open(DictApp app, String query) {
        Intent intent;
        if ("colordict".equals(app.kind)) {
            int height = (int) (getResources().getDisplayMetrics().heightPixels * 0.55);
            intent = new Intent(COLORDICT_SEARCH)
                    .setPackage(app.pkg)
                    .putExtra("EXTRA_QUERY", query)
                    .putExtra("EXTRA_FULLSCREEN", false)
                    .putExtra("EXTRA_HEIGHT", height)
                    .putExtra("EXTRA_GRAVITY", Gravity.BOTTOM)
                    .putExtra("EXTRA_MARGIN_LEFT", 0)
                    .putExtra("EXTRA_MARGIN_RIGHT", 0);
        } else {
            intent = new Intent(Intent.ACTION_PROCESS_TEXT)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_PROCESS_TEXT, query)
                    .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true);
            if (app.cls != null) intent.setClassName(app.pkg, app.cls);
            else intent.setPackage(app.pkg);
        }
        try {
            startActivity(intent);
            overridePendingTransition(0, 0);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** All dictionary-capable apps on this phone (ColorDict API preferred over "process text" for the same app). */
    private List<DictApp> installedDictionaries() {
        PackageManager pm = getPackageManager();
        Map<String, DictApp> byPkg = new LinkedHashMap<>();
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(COLORDICT_SEARCH), 0)) {
            String pkg = ri.activityInfo.packageName;
            byPkg.put(pkg, new DictApp(pkg, null, "colordict", String.valueOf(ri.loadLabel(pm)) + "  (popup)"));
        }
        Intent processText = new Intent(Intent.ACTION_PROCESS_TEXT).setType("text/plain");
        for (ResolveInfo ri : pm.queryIntentActivities(processText, 0)) {
            String pkg = ri.activityInfo.packageName;
            if (byPkg.containsKey(pkg) || pkg.equals(getPackageName())) continue;
            String appLabel = String.valueOf(ri.activityInfo.applicationInfo.loadLabel(pm));
            String actionLabel = String.valueOf(ri.loadLabel(pm));
            String label = appLabel.equals(actionLabel) ? appLabel : appLabel + " — " + actionLabel;
            byPkg.put(pkg + "/" + ri.activityInfo.name, new DictApp(pkg, ri.activityInfo.name, "process_text", label));
        }
        List<DictApp> list = new ArrayList<>(byPkg.values());
        Collections.sort(list, (a, b) -> a.label.compareToIgnoreCase(b.label));
        return list;
    }

    private void choose(String pendingQuery) {
        List<DictApp> apps = installedDictionaries();
        if (apps.isEmpty()) {
            Toast.makeText(this, "No dictionary app found. Install ColorDict, Google Translate or another dictionary.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        String[] labels = new String[apps.size()];
        for (int i = 0; i < apps.size(); i++) labels[i] = apps.get(i).label;
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
                .setTitle("Look up words with")
                .setItems(labels, (dialog, which) -> {
                    DictApp app = apps.get(which);
                    prefs().edit()
                            .putString(KEY_PKG, app.pkg)
                            .putString(KEY_CLS, app.cls)
                            .putString(KEY_KIND, app.kind)
                            .apply();
                    if (pendingQuery != null) open(app, pendingQuery);
                    else Toast.makeText(this, "Look up will use " + app.label.replace("  (popup)", ""), Toast.LENGTH_SHORT).show();
                    finish();
                })
                .setOnCancelListener(dialog -> finish())
                .show();
    }
}
