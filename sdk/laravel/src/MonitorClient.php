<?php

namespace Mahaam\Feedback;

use Illuminate\Http\Client\Factory as HttpFactory;
use Throwable;

/**
 * Sentry-shaped error monitoring: a DSN, not the feedback widget's pfk_ key, and it reports to
 * the project's board as an issue instead of the "report a problem" intake. Get a DSN from a
 * project's Settings -> Monitoring in Mahaam.
 */
class MonitorClient
{
    private ?string $ingestUrl = null;

    private ?string $publicKey = null;

    public function __construct(private array $config, private HttpFactory $http)
    {
        $dsn = trim((string) ($config['dsn'] ?? ''));
        if ($dsn === '') {
            return;
        }
        $parts = parse_url($dsn);
        if ($parts === false) {
            return; // an invalid DSN disables the client rather than throwing
        }
        $project = trim($parts['path'] ?? '', '/');
        $project = preg_replace('#^monitor/#', '', $project);
        if (empty($parts['user']) || $project === '' || empty($parts['scheme']) || empty($parts['host'])) {
            return; // an invalid DSN disables the client rather than throwing
        }
        $this->publicKey = $parts['user'];
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';
        $this->ingestUrl = "{$parts['scheme']}://{$parts['host']}{$port}/api/monitor/{$project}/envelope";
    }

    public function enabled(): bool
    {
        return (bool) ($this->config['enabled'] ?? true) && $this->publicKey !== null;
    }

    /**
     * Sends one event. Never throws — a monitoring hiccup must never be the reason a request
     * fails; failures are just silently dropped (nothing here is important enough to log-spam
     * the app's own error channel with monitoring-of-the-monitoring).
     *
     * @param  array<string,string>  $tags
     * @param  array<string,mixed>  $extra
     */
    public function capture(
        ?string $message = null,
        ?string $type = null,
        ?string $value = null,
        ?string $stacktrace = null,
        string $level = 'error',
        array $tags = [],
        array $extra = [],
        ?string $fingerprint = null,
    ): void {
        if (! $this->enabled()) {
            return;
        }
        try {
            $this->http->asJson()
                ->timeout((int) ($this->config['timeout'] ?? 10))
                ->post($this->ingestUrl, array_filter([
                    'public_key' => $this->publicKey,
                    'level' => $level,
                    'message' => $message,
                    'exception_type' => $type,
                    'exception_value' => $value,
                    'stacktrace' => $stacktrace,
                    'environment' => $this->config['environment'] ?? null,
                    'release' => $this->config['release'] ?? null,
                    'server_name' => $this->config['server_name'] ?? gethostname(),
                    'fingerprint' => $fingerprint,
                    'tags' => $tags ?: null,
                    'extra' => $extra ?: null,
                ], static fn ($v) => $v !== null));
        } catch (Throwable) {
            // best-effort, see the docblock above
        }
    }

    /** Reports a caught exception. Never throws. */
    public function captureException(Throwable $e, array $extra = []): void
    {
        $this->capture(
            type: get_class($e),
            value: $e->getMessage(),
            stacktrace: $e->getFile().':'.$e->getLine()."\n\n".$e->getTraceAsString(),
            level: 'error',
            extra: $extra,
        );
    }
}
