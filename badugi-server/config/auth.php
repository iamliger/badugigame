<?php

return [

    'defaults' => [
        'guard' => 'web',
        'passwords' => 'users',
    ],

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],
        'sanctum' => [
            'driver' => 'sanctum',
            'provider' => 'users',
        ],
        'api' => [ // JWTAuth를 위한 api 가드 (기존 사용자)
            'driver' => 'jwt',
            'provider' => 'users',
        ],
        // ✨ FIX: 로봇 전용 가드 (Sanctum 발급용) - 드라이버를 'sanctum'으로 변경
        'robot' => [
            'driver' => 'sanctum', // ✨ MODIFIED: 'eloquent' 대신 'sanctum' 드라이버 사용
            'provider' => 'robots', // 'robots' 프로바이더 사용
        ],
    ],

    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => App\Models\User::class,
        ],
        // 로봇 전용 프로바이더는 그대로 유지
        'robots' => [
            'driver' => 'eloquent',
            'model' => App\Models\Robot::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => 10800,

];