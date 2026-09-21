<?php

namespace Mahaam\Feedback;

use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;

class FeedbackServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/mahaam-feedback.php', 'mahaam-feedback');
        $this->mergeConfigFrom(__DIR__.'/../config/mahaam-monitor.php', 'mahaam-monitor');

        $this->app->singleton(FeedbackClient::class, fn ($app) => new FeedbackClient(
            // A config/managy-feedback.php published before the rename still applies.
            array_merge($app['config']->get('mahaam-feedback', []), $app['config']->get('managy-feedback', [])),
            $app->make(HttpFactory::class),
        ));

        $this->app->singleton(MonitorClient::class, fn ($app) => new MonitorClient(
            $app['config']->get('mahaam-monitor', []),
            $app->make(HttpFactory::class),
        ));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/mahaam-feedback.php' => config_path('mahaam-feedback.php'),
            __DIR__.'/../config/mahaam-monitor.php' => config_path('mahaam-monitor.php'),
        ], 'mahaam-feedback-config');

        // @mahaamFeedback or @mahaamFeedback('ar')
        $directive = fn ($expr) => '<?php echo app(\\'.FeedbackClient::class.'::class)->scriptTag('.($expr ?: 'null').'); ?>';
        Blade::directive('mahaamFeedback', $directive);
        Blade::directive('managyFeedback', $directive); // pre-rebrand name, kept for existing layouts
    }
}
