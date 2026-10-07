package app.shivtrix.pdfpro;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Receives files from "Share" and "Open with" (PDF, Word, text, images, voice notes...),
 * copies them into the app cache and tells the web app, which fetches them via convertFileSrc().
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {

    private final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        handle(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    /** JS calls this to take (and clear) the files received so far. */
    @PluginMethod
    public void consume(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pending) {
            for (JSObject o : pending) arr.put(o);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    @SuppressWarnings("deprecation")
    private void handle(Intent intent) {
        if (intent == null) return;
        final String action = intent.getAction();
        if (action == null) return;

        final List<Uri> uris = new ArrayList<>();
        String sharedText = null;

        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
            else sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            Uri d = intent.getData();
            if (d != null) uris.add(d);
        } else {
            return;
        }
        if (uris.isEmpty() && (sharedText == null || sharedText.trim().isEmpty())) return;

        final String fallbackType = intent.getType();
        final String text = sharedText;
        intent.setAction(null); // do not process the same intent twice

        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "incoming");
                if (!dir.exists()) dir.mkdirs();
                ContentResolver cr = getContext().getContentResolver();

                for (Uri u : uris) {
                    String mime = cr.getType(u);
                    if (mime == null) mime = fallbackType;
                    String name = fixName(displayName(cr, u), mime);
                    File out = new File(dir, System.currentTimeMillis() + "_" + name);
                    try (InputStream in = cr.openInputStream(u); OutputStream os = new FileOutputStream(out)) {
                        if (in == null) continue;
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    add(name, mime, out);
                }
                if (uris.isEmpty() && text != null) {
                    File out = new File(dir, System.currentTimeMillis() + "_Shared text.txt");
                    try (OutputStream os = new FileOutputStream(out)) {
                        os.write(text.getBytes("UTF-8"));
                    }
                    add("Shared text.txt", "text/plain", out);
                }
                getActivity().runOnUiThread(() -> notifyListeners("sharedFiles", new JSObject()));
            } catch (Exception e) {
                // ignore: nothing to deliver
            }
        }).start();
    }

    private void add(String name, String mime, File f) {
        JSObject o = new JSObject();
        o.put("name", name);
        o.put("mime", mime == null ? "" : mime);
        o.put("uri", Uri.fromFile(f).toString());
        synchronized (pending) {
            pending.add(o);
        }
    }

    private String displayName(ContentResolver cr, Uri u) {
        String n = null;
        if ("content".equals(u.getScheme())) {
            try (Cursor c = cr.query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) n = c.getString(0);
            } catch (Exception ignored) {
            }
        }
        if (n == null) n = u.getLastPathSegment();
        if (n == null) n = "shared-file";
        return n.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private String fixName(String name, String mime) {
        if (name.lastIndexOf('.') > 0) return name;
        String ext = mime == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
        return ext == null ? name : name + "." + ext;
    }
}
