package app.lumen.reader;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Invisible helper started by the Lumen web app:
 *   lumen://lookup?q=word  → open the chosen dictionary app with the word, as a popup where the app supports it
 *   lumen://choose         → pick the dictionary app from the apps installed on this phone
 *
 * Three ways to hand a word to another app, best first:
 *   - "colordict": the ColorDict API (action colordict.intent.action.SEARCH; ColorDict, GoldenDict, Fora, …),
 *     the one Moon+ Reader uses. EXTRA_FULLSCREEN=false makes it a floating window over the book.
 *   - "process_text": Android's text-selection action (apps in the selection menu, e.g. Google Translate's popup).
 *   - "send": plain Share of the text (any app that accepts text); opens the app itself.
 */
public class DictionaryActivity extends Activity {
    private static final String COLORDICT_SEARCH = "colordict.intent.action.SEARCH";
    private static final String PREFS = "lumen";
    private static final String KEY_PKG = "dictPackage";
    private static final String KEY_CLS = "dictClass";
    private static final String KEY_KIND = "dictKind"; // "colordict" | "process_text" | "send"

    /** A row in the chooser: an app, or a group header (pkg == null). */
    static final class DictApp {
        final String pkg;
        final String cls;
        final String kind;
        final String label;
        final Drawable icon;

        DictApp(String pkg, String cls, String kind, String label, Drawable icon) {
            this.pkg = pkg;
            this.cls = cls;
            this.kind = kind;
            this.label = label;
            this.icon = icon;
        }

        static DictApp header(String title) {
            return new DictApp(null, null, null, title, null);
        }

        boolean isHeader() {
            return pkg == null;
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
        DictApp app = new DictApp(pkg, p.getString(KEY_CLS, null), p.getString(KEY_KIND, "process_text"), "", null);
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
        } else if ("send".equals(app.kind)) {
            intent = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, query);
            if (app.cls != null) intent.setClassName(app.pkg, app.cls);
            else intent.setPackage(app.pkg);
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

    private List<DictApp> sorted(List<DictApp> list) {
        Collections.sort(list, (a, b) -> a.label.compareToIgnoreCase(b.label));
        return list;
    }

    /** All apps that can take a word, grouped best-first, each app listed once (in its best group). */
    List<DictApp> installedDictionaries() {
        PackageManager pm = getPackageManager();
        Set<String> seen = new HashSet<>();
        seen.add(getPackageName());

        List<DictApp> popup = new ArrayList<>();
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(COLORDICT_SEARCH), 0)) {
            String pkg = ri.activityInfo.packageName;
            if (!seen.add(pkg)) continue;
            popup.add(new DictApp(pkg, null, "colordict", String.valueOf(ri.activityInfo.applicationInfo.loadLabel(pm)), ri.activityInfo.applicationInfo.loadIcon(pm)));
        }

        List<DictApp> text = new ArrayList<>();
        Set<String> textPkgs = new HashSet<>();
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(Intent.ACTION_PROCESS_TEXT).setType("text/plain"), 0)) {
            String pkg = ri.activityInfo.packageName;
            if (seen.contains(pkg)) continue;
            textPkgs.add(pkg);
            String appLabel = String.valueOf(ri.activityInfo.applicationInfo.loadLabel(pm));
            String actionLabel = String.valueOf(ri.loadLabel(pm));
            String label = appLabel.equals(actionLabel) ? appLabel : appLabel + " — " + actionLabel;
            text.add(new DictApp(pkg, ri.activityInfo.name, "process_text", label, ri.loadIcon(pm)));
        }
        seen.addAll(textPkgs);

        List<DictApp> share = new ArrayList<>();
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain");
        for (ResolveInfo ri : pm.queryIntentActivities(send, 0)) {
            String pkg = ri.activityInfo.packageName;
            if (!seen.add(pkg)) continue; // one entry per app
            share.add(new DictApp(pkg, ri.activityInfo.name, "send", String.valueOf(ri.activityInfo.applicationInfo.loadLabel(pm)), ri.activityInfo.applicationInfo.loadIcon(pm)));
        }

        List<DictApp> rows = new ArrayList<>();
        if (!popup.isEmpty()) {
            rows.add(DictApp.header("Dictionaries — open as a popup"));
            rows.addAll(sorted(popup));
        }
        if (!text.isEmpty()) {
            rows.add(DictApp.header("Text tools — open on top of the book"));
            rows.addAll(sorted(text));
        }
        if (!share.isEmpty()) {
            rows.add(DictApp.header("Other apps — via Share (opens the app)"));
            rows.addAll(sorted(share));
        }
        return rows;
    }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    /** Chooser rows: group headers, then icon + app name. */
    private final class Adapter extends BaseAdapter {
        private final List<DictApp> rows;

        Adapter(List<DictApp> rows) {
            this.rows = rows;
        }

        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int i) { return rows.get(i).label; }
        @Override public long getItemId(int i) { return i; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public int getItemViewType(int i) { return rows.get(i).isHeader() ? 0 : 1; }
        @Override public boolean areAllItemsEnabled() { return false; }
        @Override public boolean isEnabled(int i) { return !rows.get(i).isHeader(); }

        @Override
        public View getView(int i, View convert, ViewGroup parent) {
            DictApp row = rows.get(i);
            if (row.isHeader()) {
                TextView h = new TextView(DictionaryActivity.this);
                h.setText(row.label.toUpperCase());
                h.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                h.setTypeface(Typeface.DEFAULT_BOLD);
                h.setTextColor(0xFF6B7280);
                h.setPadding(dp(24), dp(16), dp(24), dp(6));
                return h;
            }
            LinearLayout line = new LinearLayout(DictionaryActivity.this);
            line.setOrientation(LinearLayout.HORIZONTAL);
            line.setGravity(Gravity.CENTER_VERTICAL);
            line.setPadding(dp(24), dp(10), dp(24), dp(10));
            line.setMinimumHeight(dp(56));
            ImageView icon = new ImageView(DictionaryActivity.this);
            icon.setImageDrawable(row.icon);
            LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(36), dp(36));
            ip.setMarginEnd(dp(16));
            line.addView(icon, ip);
            TextView name = new TextView(DictionaryActivity.this);
            name.setText(row.label);
            name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            name.setTextColor(0xFF1B1F2A);
            line.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            return line;
        }
    }

    private void choose(String pendingQuery) {
        List<DictApp> rows = installedDictionaries();
        if (rows.isEmpty()) {
            Toast.makeText(this, "No app on this phone accepts text. Install ColorDict or another dictionary.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
                .setTitle("Look up words with")
                .setAdapter(new Adapter(rows), (dialog, which) -> {
                    DictApp app = rows.get(which);
                    if (app.isHeader()) return;
                    prefs().edit()
                            .putString(KEY_PKG, app.pkg)
                            .putString(KEY_CLS, app.cls)
                            .putString(KEY_KIND, app.kind)
                            .apply();
                    if (pendingQuery != null) open(app, pendingQuery);
                    else Toast.makeText(this, "Look up will use " + app.label, Toast.LENGTH_SHORT).show();
                    finish();
                })
                .setOnCancelListener(dialog -> finish())
                .show();
    }
}
