<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;
use App\Models\User;
use Tymon\JWTAuth\Facades\JWTAuth;
use Tymon\JWTAuth\Exceptions\JWTException;
use Illuminate\Support\Facades\Log;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;


class AuthController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth:api', ['except' => ['login', 'register']]);
    }

    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'password' => 'required|string|min:6',
        ]);

        if ($validator->fails()) {
            return response()->json($validator->errors(), 422);
        }

        $credentials = $request->only('email', 'password');

        if (! $token = JWTAuth::attempt($credentials)) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        // --- 이 부분이 핵심 수정입니다! ---
        // JWTAuth::attempt()가 토큰 발급에 성공하면, JWTAuth::user()를 통해 인증된 사용자를 가져올 수 있습니다.
        // 라라벨의 'api' 가드에 이 사용자를 명시적으로 설정하여,
        // 이 요청 내에서 auth('api')->user()가 올바르게 작동하도록 합니다.
        if ($user = JWTAuth::user()) {
            Auth::guard('api')->setUser($user);
        } else {
            // 이 경우는 발생해서는 안 되는 상황이지만, 혹시 모르니 로깅
            Log::error('JWTAuth::attempt succeeded but JWTAuth::user() is null within AuthController->login().');
        }
        // --- 수정 끝 ---

        return $this->respondWithToken($token);
    }

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
            ['password' => bcrypt($request->password)]
        ));

        return response()->json([
            'message' => 'User successfully registered',
            'user' => $user
        ], 201);
    }

    public function me()
    {
        return response()->json(auth('api')->user());
    }

    public function logout()
    {
        auth('api')->logout();

        return response()->json(['message' => 'Successfully logged out']);
    }

    public function refresh()
    {
        return $this->respondWithToken(auth('api')->refresh());
    }

    protected function respondWithToken($token)
    {
        return response()->json([
            'access_token' => $token,
            'token_type' => 'bearer',
            'expires_in' => auth('api')->factory()->getTTL() * 60,
            'user' => auth('api')->user() // 이제 이 부분에서 사용자 정보가 나오기를 기대합니다.
        ]);
    }

    public function getUserChips()
    {
        $user = auth('api')->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        return response()->json(['chips' => $user->points]);
    }

    public function checkTokenValidity(Request $request)
    {
        try {
            if (!$user = JWTAuth::parseToken()->authenticate()) {
                return response()->json(['status' => 'error', 'message' => 'User not found'], 404);
            }
            return response()->json(['status' => 'success', 'message' => 'Token is valid', 'user' => $user], 200);
        } catch (TokenExpiredException $e) {
            Log::error('[API] JWT TokenExpiredException detected in checkTokenValidity.');
            return response()->json(['status' => 'error', 'message' => 'Token expired. Please re-login.'], 401);
        } catch (TokenInvalidException $e) {
            Log::error('[API] JWT TokenInvalidException detected in checkTokenValidity.');
            return response()->json(['status' => 'error', 'message' => 'Token invalid.'], 401);
        } catch (\Exception $e) {
            Log::error('[API] General JWT error in checkTokenValidity: ' . $e->getMessage());
            return response()->json(['status' => 'error', 'message' => 'Token error.'], 401);
        }
    }
}