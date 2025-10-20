<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Robot; // Robot 모델 임포트
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Facades\Log;

class RobotAuthController extends Controller
{
    /**
     * 로봇 로그인 및 Sanctum 토큰 발급.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        $robot = Robot::where('email', $request->email)->first();

        if (!$robot || !Hash::check($request->password, $robot->password)) {
            Log::warning('[RobotAuth] 로봇 로그인 실패: 잘못된 이메일 또는 비밀번호.', ['email' => $request->email]);
            throw ValidationException::withMessages([
                'email' => ['제공된 자격 증명이 유효하지 않습니다.'],
            ]);
        }

        // 로봇의 기존 토큰을 모두 삭제하고 새로운 토큰 발급
        // (보안 정책에 따라 기존 토큰을 유지할지 삭제할지 결정)
        $robot->tokens()->delete(); // 기존 토큰 삭제
        $token = $robot->createToken('robot-auth-token', ['robot:access'])->plainTextToken;

        Log::info("[RobotAuth] 로봇 로그인 성공: ID {$robot->id}, 이메일 {$robot->email}, 토큰: {$token}");

        return response()->json([
            'status' => 'success',
            'message' => '로봇 로그인 성공',
            'access_token' => $token,
            'token_type' => 'Bearer',
            'robot' => $robot->toArray(), // 로봇 정보를 함께 전달
        ]);
    }

    /**
     * 로봇 Sanctum 토큰 유효성 검사 (Node.js 서버에서 호출).
     * `auth:sanctum,robot` 미들웨어에 의해 보호됩니다.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function checkToken(Request $request)
    {
        // 이 라우트에 도달했다면 `auth:sanctum,robot` 미들웨어에 의해 이미 인증된 상태입니다.
        // 따라서 $request->user('robot')으로 직접 인증된 로봇 인스턴스를 가져올 수 있습니다.
        $robot = $request->user('robot');

        if ($robot) {
            Log::debug('[RobotAuth] 로봇 토큰 유효성 검사 성공: 로봇 ID: ' . $robot->id);
            return response()->json([
                'status' => 'success',
                'message' => '로봇 토큰 유효함',
                'robot' => [ // 필요한 로봇 정보만 전달
                    'id' => $robot->id,
                    'name' => $robot->name,
                    'email' => $robot->email,
                    'points' => $robot->points ?? 0,
                    'is_active' => $robot->is_active ?? false,
                ]
            ]);
        }

        // 미들웨어가 인증을 실패했거나 (극히 드물게) 사용자를 찾지 못한 경우
        Log::warning('[RobotAuth] 로봇 토큰 유효성 검사 실패: 유효하지 않거나 만료된 토큰 (미들웨어 처리 오류).');
        return response()->json(['status' => 'error', 'message' => '유효하지 않거나 만료된 토큰입니다.'], 401);
    }
}