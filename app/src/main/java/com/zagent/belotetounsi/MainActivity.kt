package com.zagent.belotetounsi

import android.annotation.SuppressLint
import android.os.Bundle
import android.text.InputType
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()

        val prefs = getSharedPreferences("belote", MODE_PRIVATE)
        val savedUrl = prefs.getString("game_url", null)

        if (savedUrl.isNullOrBlank()) {
            askGameUrlAndLoad()
        } else {
            webView.loadUrl(savedUrl)
        }
    }

    private fun askGameUrlAndLoad() {
        val prefs = getSharedPreferences("belote", MODE_PRIVATE)
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(getString(R.string.default_game_url))
            hint = "http://your-server-ip:8080"
        }

        AlertDialog.Builder(this)
            .setTitle("Belote server URL")
            .setMessage("Enter your Belote web app URL")
            .setView(input)
            .setCancelable(false)
            .setPositiveButton("Open") { _, _ ->
                val url = normalizeUrl(input.text?.toString().orEmpty())
                prefs.edit().putString("game_url", url).apply()
                webView.loadUrl(url)
            }
            .show()
    }

    private fun normalizeUrl(raw: String): String {
        val value = raw.trim()
        if (value.startsWith("http://") || value.startsWith("https://")) return value
        return "http://$value"
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
