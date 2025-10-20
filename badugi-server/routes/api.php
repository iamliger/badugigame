<?php

use App\Http\Controllers\RobotController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController; // ✨ MODIFIED: Api 네임스페이스에 있는 AuthController 임포트
use App\Http\Controllers\RobotAuthController; // RobotAuthController 임포트

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

Route::prefix('robot-control')->middleware('auth:sanctum')->group(function () {
    Route::post('/start', [RobotController::class, 'startRobots'])->name('api.robot-control.start');
    Route::post('/stop', [RobotController::class, 'stopRobots'])->name('api.robot-control.stop');
});

// 일반 사용자 인증 관련 라우트 (JWTAuth 사용)
Route::prefix('auth')->group(function () {
    Route::post('login', [AuthController::class, 'login']);
    Route::post('register', [AuthController::class, 'register']); // ✨ NEW: register 라우트도 추가
    Route::middleware('auth:api')->post('logout', [AuthController::class, 'logout']); // 'auth:api' 미들웨어 사용
    Route::middleware('auth:api')->get('me', [AuthController::class, 'me']);           // 'auth:api' 미들웨어 사용
    Route::middleware('auth:api')->post('refresh', [AuthController::class, 'refresh']); // 'auth:api' 미들웨어 사용
    Route::middleware('auth:api')->get('user-chips', [AuthController::class, 'userChips']); // 'auth:api' 미들웨어 사용

    // ✨ FIX: checkToken 라우트 정의 (Node.js에서 POST를 보내므로 POST 허용)
    Route::middleware('auth:api')->post('check-token', [AuthController::class, 'checkToken'])->name('api.auth.check-token');
});

// 로봇 인증 관련 라우트 (Sanctum 사용)
Route::prefix('robot-auth')->group(function () {
    Route::post('login', [RobotAuthController::class, 'login']);
    // ✨ FIX: check-token 라우트에 'auth:sanctum,robot' 미들웨어 명시 (Node.js 서버에서 Sanctum 로봇 토큰 검증용)
    Route::post('check-token', [RobotAuthController::class, 'checkToken'])->middleware('auth:sanctum,robot');
});