<?php

// The package was published as managy/feedback (namespace Managy\Feedback) before the product was
// renamed Mahaam. These aliases keep code written against the old names working.
foreach ([
    'Managy\Feedback\FeedbackClient' => \Mahaam\Feedback\FeedbackClient::class,
    'Managy\Feedback\FeedbackException' => \Mahaam\Feedback\FeedbackException::class,
    'Managy\Feedback\FeedbackServiceProvider' => \Mahaam\Feedback\FeedbackServiceProvider::class,
    'Managy\Feedback\Facades\ManagyFeedback' => \Mahaam\Feedback\Facades\MahaamFeedback::class,
] as $old => $new) {
    if (! class_exists($old, false)) {
        class_alias($new, $old);
    }
}
