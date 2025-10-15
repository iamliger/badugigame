<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\RobotController; // ✨ FIX: 네임스페이스 경로 수정


Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

// JWT 인증 관련 API 라우트
Route::group([
    'middleware' => 'api', // API 미들웨어 그룹 사용 (config/auth.php의 'api' 가드)
    'prefix' => 'auth'     // 모든 라우트 앞에 '/api/auth' 접두사 추가
], function ($router) {
    Route::post('login', [AuthController::class, 'login']);
    Route::post('register', [AuthController::class, 'register']); // 회원가입 라우트 추가
    Route::post('logout', [AuthController::class, 'logout']);
    Route::post('refresh', [AuthController::class, 'refresh']);
    Route::post('me', [AuthController::class, 'me']); // 인증된 사용자 정보 가져오기
    Route::get('user-chips', [AuthController::class, 'getUserChips']);
    Route::get('check-token', [AuthController::class, 'checkTokenValidity']);
});

// ✨ NEW: 로봇 제어 API 라우트
Route::middleware('auth:sanctum')->group(function () {
    Route::post('/robot-control/start', [RobotController::class, 'startRobots'])->name('api.robot-control.start'); // ✨ FIX: 라우트 이름 지정
    Route::post('/robot-control/stop', [RobotController::class, 'stopRobots'])->name('api.robot-control.stop'); // ✨ FIX: 라우트 이름 지정
    // 필요시 로봇 개수 설정 API 등 추가 가능
});