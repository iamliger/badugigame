<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Filament\Models\Contracts\FilamentUser; // ✨ NEW: FilamentUser 인터페이스 임포트
use Filament\Panel; // ✨ NEW: Filament Panel 임포트
use Illuminate\Auth\Authenticatable; // ✨ 이 트레이트가 `Robot` 모델의 인증 기능을 제공합니다.
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;


class Robot extends Model implements FilamentUser, AuthenticatableContract // ✨ MODIFIED: FilamentUser 인터페이스 구현
{
    use HasFactory, Notifiable, HasApiTokens, Authenticatable;

    protected $fillable = [
        'name',
        'email',
        'password',
        'points',
        'is_active',
    ];

    protected $hidden = [
        'password',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'password' => 'hashed',
    ];

    public function canAccessPanel(Panel $panel): bool
    {
        return false;
    }
}