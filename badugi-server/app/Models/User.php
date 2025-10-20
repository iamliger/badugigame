<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Tymon\JWTAuth\Contracts\JWTSubject;
use Illuminate\Support\Facades\Log; // ✨ NEW: Log 퍼사드 임포트

class User extends Authenticatable implements FilamentUser, JWTSubject
{
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        "points", // ✨ NEW: 'points' 필드 mass assignable에 포함
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'email_verified_at' => 'datetime',
        // 'password' => 'hashed',
        'points' => 'integer', // ✨ NEW: points 필드를 integer로 캐스팅
    ];

    // protected $appends = ['points']; // ✨ NOTE: points 필드를 직접 모델에 추가했으므로 $appends는 필요 없습니다.

    /**
     * 현재 사용자가 가질 수 있는 기본 Sanctum 권한 (Abilities)을 정의합니다.
     * 이 예시에서는 로봇 제어 권한을 관리자 사용자에게 부여할 수 있도록 합니다.
     *
     * @return array<int, string>
     */
    public function defaultAbilities(): array
    {
        // 일반 사용자는 기본적으로 특정 Sanctum 권한을 가지지 않거나
        // 'user:access' 와 같은 일반 접근 권한을 가질 수 있습니다.
        // 로봇 제어 권한은 관리자 사용자에게만 명시적으로 부여하는 것이 좋습니다.
        // 현재는 'robot:control' 권한을 이 모델의 토큰에 포함시키는 예시입니다.
        // 이 권한이 필요한 경우, `createToken` 시 명시적으로 전달하거나
        // 사용자의 역할(role)에 따라 동적으로 결정하는 로직을 추가해야 합니다.
        if ($this->isAdmin()) {
            return ['user:access', 'robot:control'];
        }
        return ['user:access'];
    }

    /**
     * Filament 관리자 패널에 접근할 수 있는지 확인합니다.
     *
     * @return bool
     */
    public function canAccessFilament(): bool
    {
        // ✨ MODIFIED: 'isAdmin' 메서드를 통해 실제 관리자 권한을 확인하도록 변경
        return $this->isAdmin();
    }

    /**
     * 현재 사용자가 관리자 권한을 가지고 있는지 확인합니다.
     *
     * ✨ MODIFIED: 실제 관리자 역할 확인 로직의 예시를 추가
     * (예: 데이터베이스에 'role' 컬럼을 추가하고 'admin'인지 확인)
     * @return bool
     */
    public function isAdmin(): bool
    {
        // TODO: 실제 프로젝트에서는 'role' 컬럼을 추가하거나
        // 더 복잡한 권한 관리 시스템(예: Spatie/laravel-permission)을 사용해야 합니다.
        // 임시로 특정 이메일 주소만 관리자로 간주하는 예시입니다.
        $adminEmail = env('ADMIN_EMAIL', 'admin@domain.com'); // .env에서 관리자 이메일 설정
        $isSuperAdmin = ($this->email === $adminEmail);

        // 또는 데이터베이스에 'role' 컬럼이 있다면:
        // return $this->role === 'admin';

        if ($isSuperAdmin) {
            Log::debug('User ' . $this->email . ' is identified as admin.');
        }
        return $isSuperAdmin;
    }


    /**
     * 특정 Filament 패널에 접근할 수 있는지 확인합니다.
     *
     * @param \Filament\Panel $panel
     * @return bool
     */
    public function canAccessPanel(Panel $panel): bool
    {
        // ✨ MODIFIED: 이메일 대신 isAdmin()을 활용하거나, 특정 패널에 대한 더 세부적인 권한 검사
        // `RobotControl` 패널은 일반 사용자가 접근하지 못하도록 FilamentNavigaton에서 숨기거나
        // 여기서 `false`를 반환할 수 있습니다.
        if ($panel->getId() === 'admin') { // 'admin' ID를 가진 패널에 대한 접근 제어
            return $this->isAdmin(); // 관리자만 admin 패널에 접근 가능
        }

        // 다른 패널에 대한 접근 제어 (필요시 추가)
        return false; // 기본적으로 다른 패널에는 접근 불가
    }

    /**
     * Get the identifier that will be stored in the subject claim of the JWT.
     *
     * @return mixed
     */
    public function getJWTIdentifier()
    {
        return $this->getKey();
    }

    /**
     * Return a key value array, containing any custom claims to be added to the JWT.
     *
     * @return array
     */
    public function getJWTCustomClaims()
    {
        return [
            'name' => $this->name,
            'email' => $this->email, // ✨ NEW: 이메일도 JWT 페이로드에 포함 (디버깅 및 클라이언트 편의성)
            'points' => $this->points,
        ];
    }
}