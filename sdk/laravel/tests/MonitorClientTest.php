<?php

namespace Mahaam\Feedback\Tests;

use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Mahaam\Feedback\MonitorClient;
use PHPUnit\Framework\TestCase;

class MonitorClientTest extends TestCase
{
    public function test_no_dsn_is_inert(): void
    {
        $c = new MonitorClient(['dsn' => null], new Factory);
        $this->assertFalse($c->enabled());
        $c->capture('should be a no-op'); // must not throw
        $this->addToAssertionCount(1);
    }

    public function test_invalid_dsn_disables_rather_than_throws(): void
    {
        $this->assertFalse((new MonitorClient(['dsn' => 'not a url'], new Factory))->enabled());
        $this->assertFalse((new MonitorClient(['dsn' => 'https://m.test/monitor/p1'], new Factory))->enabled()); // no key
        $this->assertFalse((new MonitorClient(['dsn' => 'https://key@m.test/'], new Factory))->enabled()); // no project
    }

    public function test_capture_posts_the_envelope(): void
    {
        $http = new Factory;
        $http->fake(['m.test/api/monitor/proj-1/envelope' => $http->response(['key' => 'MH-1', 'status' => 'created'], 201)]);

        $c = new MonitorClient(['dsn' => 'https://mdsn_test@m.test/monitor/proj-1', 'environment' => 'test'], $http);
        $this->assertTrue($c->enabled());
        $c->capture(type: 'RuntimeException', value: 'x is not a function', level: 'fatal');

        $http->assertSent(function (Request $r) {
            $body = $r->data();

            return $r->url() === 'https://m.test/api/monitor/proj-1/envelope'
                && $body['public_key'] === 'mdsn_test'
                && $body['exception_type'] === 'RuntimeException'
                && $body['level'] === 'fatal'
                && $body['environment'] === 'test';
        });
    }

    public function test_capture_never_throws_on_failure(): void
    {
        $http = new Factory;
        $http->fake(['*' => $http->response(['error' => 'nope'], 500)]);
        $c = new MonitorClient(['dsn' => 'https://key@m.test/monitor/p1'], $http);
        $c->capture('x'); // must not throw
        $this->addToAssertionCount(1);
    }
}
