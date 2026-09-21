<?php

namespace Mahaam\Feedback\Facades;

use Illuminate\Support\Facades\Facade;
use Mahaam\Feedback\MonitorClient;
use Throwable;

/**
 * @method static bool enabled()
 * @method static void capture(?string $message = null, ?string $type = null, ?string $value = null, ?string $stacktrace = null, string $level = 'error', array $tags = [], array $extra = [], ?string $fingerprint = null)
 * @method static void captureException(Throwable $e, array $extra = [])
 */
class MahaamMonitor extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return MonitorClient::class;
    }
}
