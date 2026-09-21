<?php

// Sentry-shaped error monitoring, separate from mahaam-feedback.php's widget config.
return [
    'enabled' => env('MAHAAM_MONITOR_ENABLED', true),

    // https://<public_key>@host/monitor/<project_id> from a project's Settings -> Monitoring.
    'dsn' => env('MAHAAM_DSN'),

    'environment' => env('MAHAAM_MONITOR_ENVIRONMENT', env('APP_ENV')),
    'release' => env('MAHAAM_MONITOR_RELEASE'),
    'server_name' => env('MAHAAM_MONITOR_SERVER_NAME'),

    // HTTP timeout in seconds.
    'timeout' => 10,
];
