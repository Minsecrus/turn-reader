package app.turn.reader

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.Locale

/**
 * Edge-to-edge activity. The page lays itself out around the system bars using
 * the insets passed through [Bridge], and hides the bars while reading.
 */
class MainActivity : TauriActivity() {
  @Volatile private var insets = "0,0,0,0"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  @SuppressLint("JavascriptInterface")
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(Bridge(), "TurnAndroid")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
      // Measured as if the bars were showing, so hiding them while reading
      // doesn't change the layout (which would reflow the book).
      val i = windowInsets.getInsetsIgnoringVisibility(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val density = resources.displayMetrics.density
      val value = listOf(i.top, i.right, i.bottom, i.left)
        .joinToString(",") { String.format(Locale.ROOT, "%.1f", it / density) }
      if (value != insets) {
        insets = value
        webView.evaluateJavascript("window.__turnInsets?.('$value')", null)
      }
      windowInsets
    }
  }

  /** Exposed to the page as `window.TurnAndroid`. Called on a background thread. */
  private inner class Bridge {
    /** System bar and cutout insets in CSS px: "top,right,bottom,left". */
    @JavascriptInterface
    fun insets(): String = this@MainActivity.insets

    /** Shows or hides the status and navigation bars, and sets their icon color. */
    @JavascriptInterface
    fun setSystemBars(hidden: Boolean, lightBackground: Boolean) = runOnUiThread {
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = lightBackground
      controller.isAppearanceLightNavigationBars = lightBackground
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      if (hidden) controller.hide(WindowInsetsCompat.Type.systemBars())
      else controller.show(WindowInsetsCompat.Type.systemBars())
    }

    /** Back from the bookshelf: leave the app running, like the default back behavior. */
    @JavascriptInterface
    fun moveToBack() = runOnUiThread { moveTaskToBack(true) }
  }
}
