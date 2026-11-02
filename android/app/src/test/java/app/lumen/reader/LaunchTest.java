package app.lumen.reader;

import android.content.Intent;
import android.net.Uri;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** Smoke tests: the launcher and the dictionary helper start without crashing. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LaunchTest {
    @Test
    public void launcherStarts() {
        Robolectric.buildActivity(LauncherActivity.class, new Intent(Intent.ACTION_MAIN)).setup();
    }

    @Test
    public void dictionaryChooserStarts() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("lumen://choose"));
        Robolectric.buildActivity(DictionaryActivity.class, i).setup();
    }

    @Test
    public void dictionaryLookupStarts() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("lumen://lookup?q=serendipity"));
        Robolectric.buildActivity(DictionaryActivity.class, i).setup();
    }
}
