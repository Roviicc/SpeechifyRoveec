package app.lumen.reader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.widget.ListView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.shadows.ShadowPackageManager;

/** With dictionary apps installed: choose one, then look up a word (ColorDict popup / process-text). */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ChooserTest {
    private void install(String pkg, String cls, String action, boolean textType) throws Exception {
        ShadowPackageManager spm = Shadows.shadowOf(RuntimeEnvironment.getApplication().getPackageManager());
        ComponentName cn = new ComponentName(pkg, cls);
        spm.addActivityIfNotPresent(cn);
        IntentFilter f = new IntentFilter(action);
        f.addCategory(Intent.CATEGORY_DEFAULT);
        if (textType) f.addDataType("text/plain");
        spm.addIntentFilterForActivity(cn, f);
    }

    @Test
    public void chooseColorDictThenLookUpOpensPopup() throws Exception {
        install("com.socialnmobile.colordict", "com.socialnmobile.colordict.activity.Main", "colordict.intent.action.SEARCH", false);
        install("com.socialnmobile.colordict", "com.socialnmobile.colordict.activity.ProcessText", Intent.ACTION_PROCESS_TEXT, true);
        install("com.google.android.apps.translate", "com.google.android.apps.translate.copydrop.gm3.TapToTranslateActivity", Intent.ACTION_PROCESS_TEXT, true);
        install("com.example.sharedict", "com.example.sharedict.ShareActivity", Intent.ACTION_SEND, true);

        // first lookup with nothing chosen yet -> chooser dialog
        DictionaryActivity a = Robolectric.buildActivity(DictionaryActivity.class,
                new Intent(Intent.ACTION_VIEW, Uri.parse("lumen://lookup?q=serendipity"))).setup().get();
        AlertDialog dialog = (AlertDialog) ShadowAlertDialog.getLatestDialog();
        assertNotNull("chooser shown", dialog);
        ListView list = dialog.getListView();
        // 3 group headers + ColorDict (once, in the popup group) + Translate + the share-only app
        assertEquals(6, list.getAdapter().getCount());
        assertEquals(false, list.getAdapter().isEnabled(0)); // header
        int colorDict = 1; // first app, under "Dictionaries — open as a popup"
        assertEquals(true, list.getAdapter().isEnabled(colorDict));
        Shadows.shadowOf(dialog).clickOnItem(colorDict);
        Intent started = Shadows.shadowOf(a).getNextStartedActivity();
        assertNotNull(started);
        assertEquals("colordict.intent.action.SEARCH", started.getAction());
        assertEquals("serendipity", started.getStringExtra("EXTRA_QUERY"));
        assertEquals(false, started.getBooleanExtra("EXTRA_FULLSCREEN", true));

        // next lookup goes straight to ColorDict, no dialog
        DictionaryActivity b = Robolectric.buildActivity(DictionaryActivity.class,
                new Intent(Intent.ACTION_VIEW, Uri.parse("lumen://lookup?q=walkable"))).setup().get();
        Intent second = Shadows.shadowOf(b).getNextStartedActivity();
        assertNotNull(second);
        assertEquals("walkable", second.getStringExtra("EXTRA_QUERY"));
    }
}
