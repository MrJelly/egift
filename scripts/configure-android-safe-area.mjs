import { promises as fs } from "node:fs";
import path from "node:path";

const javaRoot = path.resolve("src-tauri/gen/android/app/src/main/java");

async function findMainActivity(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findMainActivity(fullPath);
      if (found) return found;
    } else if (entry.name === "MainActivity.kt") {
      return fullPath;
    }
  }
  return null;
}

const mainActivityPath = await findMainActivity(javaRoot);
if (!mainActivityPath) {
  throw new Error(`MainActivity.kt not found under ${javaRoot}. Run "tauri android init" first.`);
}

const original = await fs.readFile(mainActivityPath, "utf8");
const packageName = original.match(/^package\s+([^\s]+)\s*$/m)?.[1];
if (!packageName) throw new Error(`Unable to read package name from ${mainActivityPath}`);

const source = `package ${packageName}

import android.os.Bundle
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Android 15 enforces edge-to-edge. Keep the WebView inside the real
    // system-bar and display-cutout insets in every orientation and on every
    // navigation mode instead of guessing those values in CSS.
    WindowCompat.setDecorFitsSystemWindows(window, false)
    val rootView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, windowInsets ->
      val safeTypes = WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout()
      val safeInsets = windowInsets.getInsets(safeTypes)
      view.setPadding(safeInsets.left, safeInsets.top, safeInsets.right, safeInsets.bottom)

      // Native code already applied these dimensions. Zero them before the
      // WebView receives the insets so CSS cannot add the same padding twice.
      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
        .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(rootView)
  }
}
`;

await fs.writeFile(mainActivityPath, source, "utf8");
console.log(`Configured Android safe-area handling: ${mainActivityPath}`);
