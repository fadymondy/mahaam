<?php

namespace Mahaam\Feedback\Tests;

use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Mahaam\Feedback\FeedbackClient;
use Mahaam\Feedback\FeedbackException;
use PHPUnit\Framework\TestCase;

class FeedbackClientTest extends TestCase
{
    private function client(Factory $http, array $cfg = []): FeedbackClient
    {
        return new FeedbackClient($cfg + [
            'enabled' => true, 'key' => 'pfk_ok', 'base_url' => 'https://m.test/',
            'locale' => 'en', 'app_url' => 'https://app.test',
        ], $http);
    }

    public function test_script_tag_is_escaped(): void
    {
        $c = $this->client(new Factory, ['key' => 'pfk_a"b', 'locale' => 'ar']);
        $this->assertSame('<script src="https://m.test/embed/v1.js" data-key="pfk_a&quot;b" data-locale="ar" defer></script>', $c->scriptTag());
        $this->assertSame('', $this->client(new Factory, ['enabled' => false])->scriptTag());
    }

    public function test_report_posts_to_intake(): void
    {
        $http = new Factory;
        $http->fake(['m.test/api/feedback/embed' => $http->response(['key' => 'MG-12'], 201)]);
        $this->assertSame('MG-12', $this->client($http)->report('boom', 'trace', 'bug', 'high'));
        $http->assertSent(fn (Request $r) => $r->isMultipart()
            && collect($r->data())->contains(fn ($p) => $p['name'] === 'page_url' && $p['contents'] === 'https://app.test'));
    }

    public function test_report_throws_on_403(): void
    {
        $http = new Factory;
        $http->fake(['*' => $http->response(['error' => 'origin not allowed'], 403)]);
        $this->expectException(FeedbackException::class);
        $this->client($http)->report('boom');
    }
}
