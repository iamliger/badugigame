<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;
use App\Models\User; // User 모델 임포트 확인
use Tymon\JWTAuth\Facades\JWTAuth;
use Tymon\JWTAuth\Exceptions\JWTException;
use Illuminate\Support\Facades\Log;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;
// use App\Models\Robot; // ✨ REMOVED: Robot 모델 임포트는 RobotAuthController로 이동

class AuthController extends Controller
{
    public function __construct()
    {
        // ✨ MODIFIED: 로봇 관련 메서드는 제외. checkTokenValidity -> checkToken으로 이름 변경 반영.
        $this->middleware('auth:api', ['except' => ['login', 'register', 'checkToken']]);
    }

    /**
     * 일반 사용자 로그인 및 JWT 토큰 발급.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'password' => 'required|string|min:6',
        ]);

        if ($validator->fails()) {
            Log::warning('[API] AuthController login: Validation failed for email: ' . $request->email);
            return response()->json($validator->errors(), 422);
        }

        $credentials = $request->only('email', 'password');
        Log::debug('[API] AuthController login: Attempting login for email: ' . $credentials['email']);

        // 'api' 가드를 사용하여 JWT 토큰 발급 시도
        // 이 메서드는 성공 시 토큰을 반환하며, 내부적으로 Auth::guard('api')->setUser()를 호출하여 사용자를 설정해야 합니다.
        if (! $token = JWTAuth::attempt($credentials)) {
            Log::warning('[API] AuthController login: Unauthorized credentials for email: ' . $credentials['email']);
            return response()->json(['error' => 'Unauthorized: Invalid credentials'], 401);
        }

        Log::info('[API] AuthController login: Login successful for email: ' . $credentials['email']);
        return $this->respondWithToken($token);
    }

    /**
     * 일반 사용자 회원가입.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function register(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|between:2,100',
            'email' => 'required|string|email|max:100|unique:users',
            'password' => 'required|string|confirmed|min:6',
        ]);

        if ($validator->fails()) {
            return response()->json($validator->errors(), 400);
        }

        $user = User::create(array_merge(
            $validator->validated(),
            ['password' => bcrypt($request->password)] // 비밀번호 해싱
        ));

        Log::info('[API] AuthController register: User successfully registered: ' . $user->email);
        return response()->json([
            'message' => 'User successfully registered',
            'user' => $user
        ], 201);
    }

    /**
     * 현재 인증된 사용자 정보 가져오기.
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function me()
    {
        // 'api' 가드를 통해 인증된 사용자 반환
        return response()->json(auth('api')->user());
    }

    /**
     * 현재 인증된 사용자 로그아웃 (JWT 무효화).
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function logout()
    {
        auth('api')->logout(); // JWT 토큰 무효화
        Log::info('[API] AuthController logout: Successfully logged out.');
        return response()->json(['message' => 'Successfully logged out']);
    }

    /**
     * JWT 토큰 갱신.
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function refresh()
    {
        return $this->respondWithToken(auth('api')->refresh());
    }

    /**
     * JWT 토큰과 사용자 정보를 포함하는 응답 형식.
     *
     * @param string $token
     * @return \Illuminate\Http\JsonResponse
     */
    protected function respondWithToken($token)
    {
        // ✨ MODIFIED: JWTAuth::attempt()가 반환한 토큰을 사용하여 사용자를 명시적으로 가져옵니다.
        // 이것이 auth('api')->user()가 null을 반환하는 문제를 해결하는 가장 안정적인 방법입니다.
        try {
            $user = JWTAuth::setToken($token)->authenticate();
        } catch (\Exception $e) {
            Log::error('[API] AuthController respondWithToken: Failed to retrieve user from token after successful attempt: ' . $e->getMessage());
            // 사용자 객체를 찾을 수 없는 경우, 오류 응답을 반환
            return response()->json(['error' => 'Failed to retrieve user data after authentication.'], 500);
        }

        if (!$user) {
            // 이 분기는 위에 try-catch에서 예외 처리되거나, JWTAuth::setToken()->authenticate()가 null을 반환하는 극히 드문 경우
            Log::error('[API] AuthController respondWithToken: User object is null after authenticating token.');
            return response()->json(['error' => 'User data not found after authentication.'], 500);
        }

        return response()->json([
            'access_token' => $token,
            'token_type' => 'bearer',
            'expires_in' => auth('api')->factory()->getTTL() * 60,
            // user 객체에 필요한 속성들을 명시적으로 포함
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'points' => $user->points ?? 0, // points가 없을 경우 기본값 0
            ]
        ]);
    }

    /**
     * 현재 인증된 사용자의 칩 정보 가져오기.
     *
     * @return \Illuminate\Http\JsonResponse
     */
    public function userChips()
    {
        $user = auth('api')->user();
        if (!$user) {
            Log::warning('[API] AuthController userChips: Unauthorized access, user not found.');
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        return response()->json(['chips' => $user->points]);
    }

    /**
     * 일반 사용자 JWT 토큰 유효성 검증 (Node.js 또는 클라이언트에서 호출).
     *
     * ✨ MODIFIED: 메서드 이름 `checkToken`으로 변경
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function checkToken(Request $request) // 메서드 이름 `checkTokenValidity` -> `checkToken`
    {
        try {
            // JWTAuth::parseToken()->authenticate()는 토큰 유효성 검사 및 사용자 인증을 동시에 수행
            $user = JWTAuth::parseToken()->authenticate();

            if (!$user) {
                Log::warning('[API] AuthController checkToken: User not found for valid token.');
                return response()->json(['status' => 'error', 'message' => 'User not found'], 404);
            }

            Log::debug('[API] AuthController checkToken: Token is valid for user: ' . $user->email);
            return response()->json([
                'status' => 'success',
                'message' => 'Token is valid',
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'points' => $user->points ?? 0,
                ]
            ], 200);
        } catch (TokenExpiredException $e) {
            Log::warning('[API] AuthController checkToken: Token expired: ' . $e->getMessage());
            return response()->json(['status' => 'error', 'message' => 'Token expired. Please re-login.'], 401);
        } catch (TokenInvalidException $e) {
            Log::warning('[API] AuthController checkToken: Token invalid: ' . $e->getMessage());
            return response()->json(['status' => 'error', 'message' => 'Token invalid.'], 401);
        } catch (JWTException $e) { // 일반적인 JWT 관련 예외 처리
            Log::error('[API] AuthController checkToken: General JWT error: ' . $e->getMessage());
            return response()->json(['status' => 'error', 'message' => 'JWT processing error.'], 401);
        } catch (\Exception $e) { // 그 외 모든 예외 처리
            Log::error('[API] AuthController checkToken: Unexpected error: ' . $e->getMessage());
            return response()->json(['status' => 'error', 'message' => 'An unexpected error occurred.'], 500);
        }
    }

    // ✨ REMOVED: robotLogin() 메서드 - RobotAuthController로 이동
    // ✨ REMOVED: checkRobotToken() 메서드 - RobotAuthController로 이동
}