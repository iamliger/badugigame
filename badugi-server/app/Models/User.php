<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Tymon\JWTAuth\Contracts\JWTSubject;

class User extends Authenticatable implements FilamentUser, JWTSubject
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
        "points",
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password' => 'hashed',
    ];

    // protected $appends = ['points'];

    public function defaultAbilities(): array
    {
        return [
            'robot:control' // ✨ NEW: 로봇 제어 권한 스코프 정의
        ];
    }

    // FilamentUser 인터페이스를 구현하기 위한 메서드 추가 (자동으로 추가되었을 것입니다)
    public function canAccessFilament(): bool
    {
        return str_ends_with($this->email, '@domain.com') || $this->isAdmin(); // 관리자만 접근하도록 로직 구현 (필요시 수정)
    }

    public function isAdmin(): bool
    {
        return true; // 임시로 모든 사용자가 Filament에 접근 가능하도록 설정
    }

    public function canAccessPanel(Panel $panel): bool
    {
        return $this->email === 'admin@domain.com';
    }

    public function getJWTIdentifier()
    {
        return $this->getKey();
    }

    public function getJWTCustomClaims()
    {
        return [
            'name' => $this->name, // 사용자의 'name' 속성을 JWT에 포함
            'points' => $this->points, // JWT 페이로드에도 points 추가 (Node.js 서버에서 활용 가능)
        ];
    }
    // JWTSubject 인터페이스 메서드 구현 끝
}