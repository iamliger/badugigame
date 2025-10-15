<?php

namespace App\Providers\Filament;

use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Pages;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Colors\Color;
use Filament\Widgets;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class AdminPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        return $panel
            ->default()
            ->id('admin')
            ->path('admin')
            ->login()
            ->colors([
                'primary' => Color::Amber,
            ])
            // ✨ FIX: discoverResources() 대신 resources()를 사용하거나, 다른 리소스가 없으면 비워둡니다.
            //        RobotResource를 삭제했으므로, 이 배열에 RobotResource를 포함하지 않습니다.
            // ->discoverResources(in: app_path('Filament/Resources'), for: 'App\\Filament\\Resources') // 이 라인을 주석 처리하거나 삭제합니다.
            ->resources([
                // 만약 App\Filament\Resources 폴더에 다른 유효한 리소스(예: UserResource)가 있다면
                // App\Filament\Resources\UserResource::class,
                // 과 같이 여기에 직접 등록해야 합니다.
                // 현재 RobotResource를 삭제했으므로, 다른 리소스가 없다면 이 배열은 비워둡니다.
            ])
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\\Filament\\Pages') // Custom Page는 discoverPages로 발견
            ->pages([
                Pages\Dashboard::class,
            ])
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\\Filament\\Widgets')
            ->widgets([
                Widgets\AccountWidget::class,
                Widgets\FilamentInfoWidget::class,
            ])
            ->middleware([
                StartSession::class,
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                SubstituteBindings::class,
                VerifyCsrfToken::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            ->authMiddleware([
                Authenticate::class,
            ]);
    }
}