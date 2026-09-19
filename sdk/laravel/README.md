# mahaam/feedback for Laravel

```bash
composer require mahaam/feedback   # then set MAHAAM_FEEDBACK_KEY=pfk_... (and optionally MAHAAM_URL, MAHAAM_APP_URL) in .env
```

Put `@mahaamFeedback` just before `</body>` in your layout. Use `@mahaamFeedback('ar')` to force a locale; otherwise it follows `app()->getLocale()`.

Server-side reporting:

```php
use Mahaam\Feedback\Facades\MahaamFeedback;

MahaamFeedback::report('Payment failed', $details, 'bug', 'high');   // returns "MG-12"
```

To report exceptions, add this in `bootstrap/app.php` (Laravel 11/12) or `Handler::register()` (Laravel 10):

```php
->withExceptions(fn ($e) => $e->report(fn (Throwable $t) => MahaamFeedback::reportException($t)))
```

To publish the config, run `php artisan vendor:publish --tag=mahaam-feedback-config`. Server calls send no `Origin` header, so `MAHAAM_APP_URL` must be a URL on one of the key's allowed origins. It defaults to `APP_URL`.
