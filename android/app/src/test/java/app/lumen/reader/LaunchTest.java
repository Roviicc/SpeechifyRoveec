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

    /** The TWA library enables these components at launch; a missing one crashes on real devices. */
    @Test
    public void requiredLibraryComponentsAreDeclared() throws Exception {
        android.content.pm.PackageManager pm = org.robolectric.RuntimeEnvironment.getApplication().getPackageManager();
        String pkg = org.robolectric.RuntimeEnvironment.getApplication().getPackageName();
        for (String cls : new String[] {
                "com.google.androidbrowserhelper.trusted.LauncherActivity",
                "com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity",
                "app.lumen.reader.DictionaryActivity" }) {
            pm.getActivityInfo(new android.content.ComponentName(pkg, cls), 0); // throws NameNotFoundException if missing
        }
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
