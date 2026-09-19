<?php

namespace Mahaam\Feedback;

use RuntimeException;

class FeedbackException extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct("mahaam feedback: {$status} {$message}", $status);
    }
}
