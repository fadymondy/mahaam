<?php

namespace Mahaam\Feedback\Facades;

use Illuminate\Support\Facades\Facade;
use Mahaam\Feedback\FeedbackClient;

/**
 * @method static bool enabled()
 * @method static string scriptTag(?string $locale = null)
 * @method static string|null report(string $title, ?string $body = null, ?string $type = null, ?string $priority = null, array $extra = [])
 * @method static string|null reportException(\Throwable $e, array $extra = [])
 */
class MahaamFeedback extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return FeedbackClient::class;
    }
}
