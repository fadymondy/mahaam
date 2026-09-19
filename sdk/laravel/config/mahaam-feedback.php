<?php

// Every MAHAAM_* variable falls back to its pre-rebrand MANAGY_* name.
return [
    // Turn the widget and server-side reporting on or off.
    'enabled' => env('MAHAAM_FEEDBACK_ENABLED', env('MANAGY_FEEDBACK_ENABLED', true)),

    // Project public key (pfk_...) from Mahaam: project Settings -> Feedback widget.
    'key' => env('MAHAAM_FEEDBACK_KEY', env('MANAGY_FEEDBACK_KEY')),

    // Mahaam base URL.
    'base_url' => env('MAHAAM_URL', env('MANAGY_URL', 'https://console.mahaam.app')),

    // Widget locale: en | ar. Null follows app()->getLocale().
    'locale' => env('MAHAAM_FEEDBACK_LOCALE', env('MANAGY_FEEDBACK_LOCALE')),

    // Optional data-endpoint override for the widget.
    'endpoint' => env('MAHAAM_FEEDBACK_ENDPOINT', env('MANAGY_FEEDBACK_ENDPOINT')),

    // A URL on the key's allowed origins. Server reports send it as page_url
    // (server calls have no Origin header). Defaults to APP_URL.
    'app_url' => env('MAHAAM_APP_URL', env('MANAGY_APP_URL', env('APP_URL'))),

    // HTTP timeout in seconds for server-side reports.
    'timeout' => 10,
];
