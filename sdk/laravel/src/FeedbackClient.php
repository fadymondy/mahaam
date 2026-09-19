<?php

namespace Mahaam\Feedback;

use Illuminate\Http\Client\Factory as HttpFactory;
use Throwable;

class FeedbackClient
{
    public function __construct(private array $config, private HttpFactory $http)
    {
    }

    public function enabled(): bool
    {
        return (bool) ($this->config['enabled'] ?? true) && ! empty($this->config['key']);
    }

    public function baseUrl(): string
    {
        return rtrim($this->config['base_url'] ?? 'https://console.mahaam.app', '/');
    }

    /** The widget <script> tag (HTML-escaped), or '' when disabled. */
    public function scriptTag(?string $locale = null): string
    {
        if (! $this->enabled()) {
            return '';
        }
        $e = static fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $locale = $locale ?? $this->config['locale'] ?? (function_exists('app') ? app()->getLocale() : 'en');
        $tag = sprintf(
            '<script src="%s/embed/v1.js" data-key="%s" data-locale="%s"',
            $e($this->baseUrl()), $e($this->config['key']), $e($locale ?: 'en')
        );
        if (! empty($this->config['endpoint'])) {
            $tag .= sprintf(' data-endpoint="%s"', $e($this->config['endpoint']));
        }

        return $tag.' defer></script>';
    }

    /**
     * POST to the public intake. Returns the issue key (e.g. "MG-12") or null when disabled.
     *
     * @param  array<string,string>  $extra  route, selector, user_agent, viewport, console_log, network_log, page_url
     *
     * @throws FeedbackException on a non-2xx response (403 key/origin, 422 validation, 429 rate limit)
     */
    public function report(string $title, ?string $body = null, ?string $type = null, ?string $priority = null, array $extra = []): ?string
    {
        if (! $this->enabled()) {
            return null;
        }
        if (trim($title) === '') {
            throw new FeedbackException(422, 'title is required');
        }
        $fields = array_merge(
            ['page_url' => $this->config['app_url'] ?? null],
            $extra,
            [
                'public_key' => $this->config['key'],
                'title' => mb_substr($title, 0, 200),
                'body' => $body,
                'issue_type' => $type,
                'priority' => $priority,
            ],
        );
        $fields = array_filter($fields, static fn ($v) => $v !== null && $v !== '');

        $res = $this->http->asMultipart()
            ->acceptJson()
            ->timeout((int) ($this->config['timeout'] ?? 10))
            ->post($this->baseUrl().'/api/feedback/embed', $fields);

        if (! $res->successful()) {
            throw new FeedbackException($res->status(), (string) ($res->json('error') ?? $res->body()));
        }

        return $res->json('key');
    }

    /** Report an exception as a bug. Never throws. */
    public function reportException(Throwable $e, array $extra = []): ?string
    {
        try {
            $request = function_exists('request') && app()->bound('request') ? request() : null;
            if ($request && ! app()->runningInConsole()) {
                $extra += ['route' => '/'.ltrim($request->path(), '/'), 'user_agent' => (string) $request->userAgent()];
            }

            return $this->report(
                class_basename($e).': '.$e->getMessage(),
                $e->getFile().':'.$e->getLine()."\n\n".$e->getTraceAsString(),
                'bug',
                'high',
                $extra,
            );
        } catch (Throwable) {
            return null;
        }
    }
}
