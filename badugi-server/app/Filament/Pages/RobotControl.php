<?php

namespace App\Filament\Pages;

use App\Helpers\RobotManager;
use App\Models\Robot;
use Filament\Actions;
use Filament\Forms;
use Filament\Forms\Form;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Tables\Concerns\InteractsWithTable;
use Livewire\Attributes\On; // ✨ REMOVED: 이제 필요하지 않을 수 있음 (기본 Livewire 동작에 의존)

class RobotControl extends Page implements Tables\Contracts\HasTable
{
    use InteractsWithTable;
    use InteractsWithForms;

    protected static ?string $navigationIcon = 'heroicon-o-beaker';
    protected static ?string $navigationGroup = '로봇 환경';
    protected static string $view = 'filament.pages.robot-control';
    protected static ?string $title = '로봇 제어 및 관리';

    public ?array $data = [];

    public function mount(): void
    {
        $this->form->fill();
        $this->data = [
            'robotCountToGenerate' => 5,
            'robotCountToStart' => Robot::where('is_active', false)->count()
        ];
    }

    protected function getForms(): array
    {
        return [
            'form' => $this->makeForm()
                ->schema($this->getFormSchema())
                ->statePath('data'),
        ];
    }

    protected function getHeaderActions(): array
    {
        return [
            Actions\Action::make('generateRobots')
                ->label('로봇 계정 생성')
                ->color('success')
                ->icon('heroicon-o-sparkles')
                ->action('generateRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 계정을 생성하시겠습니까?')
                ->modalDescription('이 작업은 지정된 개수만큼의 새로운 로봇 계정을 생성합니다. 이미 존재하는 이메일의 로봇은 건너뛰며, 생성 후 아래 목록에 바로 반영됩니다.')
                ->modalSubmitActionLabel('생성'),
            // ✨ REMOVED: ->after(fn() => $this->dispatch('close-modal')) - 이제 Livewire가 자동으로 모달을 닫고 테이블을 새로고침합니다.
            Actions\Action::make('startRobots')
                ->label('로봇 게임 시작')
                ->color('primary')
                ->icon('heroicon-o-play')
                ->action('startRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('로봇 게임을 시작하시겠습니까?')
                ->modalDescription('지정된 수의 비활성 로봇이 게임 서버에 접속하여 게임에 참여합니다.')
                ->modalSubmitActionLabel('시작'),
            // ✨ REMOVED: ->after(fn() => $this->dispatch('close-modal'))
            Actions\Action::make('stopAllRobots')
                ->label('모든 로봇 게임 정지')
                ->color('danger')
                ->icon('heroicon-o-stop')
                ->action('stopRobotsAction')
                ->requiresConfirmation()
                ->modalHeading('모든 로봇을 정지하시겠습니까?')
                ->modalDescription('이 작업은 되돌릴 수 없습니다. 모든 활성 로봇이 게임에서 퇴장합니다.')
                ->modalSubmitActionLabel('정지'),
            // ✨ REMOVED: ->after(fn() => $this->dispatch('close-modal'))
        ];
    }

    public function table(Table $table): Table
    {
        return $table
            ->query(Robot::query())
            // ✨ REMOVED: deferLoading() - Livewire 다운그레이드 후에는 불필요할 수 있습니다. 필요시 다시 추가하세요.
            ->columns([
                Tables\Columns\TextColumn::make('id')
                    ->label('ID')
                    ->sortable(),
                Tables\Columns\TextColumn::make('name')
                    ->label('이름')
                    ->sortable()
                    ->searchable(),
                Tables\Columns\TextColumn::make('email')
                    ->label('이메일')
                    ->sortable()
                    ->searchable(),
                Tables\Columns\TextColumn::make('points')
                    ->label('보유 칩')
                    ->numeric()
                    ->sortable(),
                Tables\Columns\IconColumn::make('is_active')
                    ->label('활성 여부')
                    ->boolean()
                    ->sortable(),
                Tables\Columns\TextColumn::make('created_at')
                    ->label('생성일')
                    ->dateTime('m-d H:i', 'Asia/Seoul')
                    ->sortable(),
                Tables\Columns\TextColumn::make('updated_at')
                    ->label('최종 수정일')
                    ->dateTime('m-d H:i', 'Asia/Seoul')
                    ->sortable(),
            ])
            ->filters([])
            ->headerActions([])
            ->actions([
                Tables\Actions\ActionGroup::make([
                    Tables\Actions\EditAction::make()
                        ->label('수정')
                        ->form(fn(Robot $record): array => static::getRobotFormSchema($record, 'edit'))
                        ->action(function (array $data, Robot $record): void {
                            try {
                                if (isset($data['password']) && filled($data['password'])) {
                                    $data['password'] = Hash::make($data['password']);
                                } else {
                                    unset($data['password']);
                                }
                                unset($data['password_confirmation']);

                                $record->update($data);
                                Notification::make()->title('로봇 업데이트 성공')->success()->send();
                            } catch (\Exception $e) {
                                Notification::make()->title('로봇 업데이트 실패')->body($e->getMessage())->danger()->send();
                            }
                        }),
                    // ✨ REMOVED: ->after(fn() => $this->dispatch('close-modal'))
                    Tables\Actions\DeleteAction::make()
                        ->label('삭제')
                        ->action(function (Robot $record): void {
                            try {
                                $record->delete();
                                Notification::make()->title('로봇 삭제 성공')->success()->send();
                            } catch (\Exception | \Throwable $e) {
                                Notification::make()->title('로봇 삭제 실패')->body($e->getMessage())->danger()->send();
                            }
                        }),
                    // ✨ REMOVED: ->after(fn() => $this->dispatch('close-modal'))
                ])
            ])
            ->bulkActions([
                Tables\Actions\BulkActionGroup::make([
                    Tables\Actions\DeleteBulkAction::make()
                        ->action(function (Collection $records): void {
                            try {
                                $records->each(fn(Robot $robot) => $robot->delete());
                                Notification::make()->title('선택된 로봇 삭제 성공')->success()->send();
                            } catch (\Exception | \Throwable $e) {
                                Notification::make()->title('로봇 삭제 실패')->body($e->getMessage())->danger()->send();
                            }
                        }),
                    // ✨ REMOVED: ->after(fn() => $this->dispatch('close-modal'))
                ]),
            ])
            ->defaultSort('id', 'asc')
            ->paginated([10, 25, 50, 100, 'all']);
    }

    public static function getRobotFormSchema(Model|array|null $robotData = null, string $operation = 'create'): array
    {
        set_time_limit(300); // ✨ MODIFIED: 실행 시간 제한 300초로 증가 (로봇 생성)
        $dataForDefaults = ($robotData instanceof Model) ? $robotData->toArray() : $robotData;

        return [
            Forms\Components\TextInput::make('name')
                ->required()
                ->maxLength(255)
                ->label('로봇 이름')
                ->default($dataForDefaults['name'] ?? null),
            Forms\Components\TextInput::make('email')
                ->email()
                ->required()
                ->maxLength(255)
                ->label('이메일')
                ->default($dataForDefaults['email'] ?? null)
                ->rules([
                    'required',
                    'email',
                    'max:255',
                    function ($attribute, $value, $fail) use ($dataForDefaults, $operation) {
                        $existingRobot = Robot::where('email', $value)->first();
                        if ($existingRobot && ($operation === 'create' || ($dataForDefaults && $existingRobot->id !== ($dataForDefaults['id'] ?? null)))) {
                            $fail('이미 존재하는 로봇 이메일입니다.');
                        }
                    },
                ]),
            Forms\Components\TextInput::make('password')
                ->password()
                // ✨ MODIFIED: `dehydrateStateUsing` 클로저를 좀 더 명확하게 변경
                ->dehydrateStateUsing(function (?string $state) use ($operation, $dataForDefaults): ?string {
                    if (filled($state)) { // 입력된 비밀번호가 있으면 해싱
                        return Hash::make($state);
                    }
                    // 수정 모드이고 비밀번호가 입력되지 않았으면 기존 비밀번호 유지 (null 반환)
                    // 생성 모드에서는 비밀번호가 필수이므로 이 분기로 오지 않음
                    return null;
                })
                // ✨ MODIFIED: `dehydrated`를 제거하거나, `nullable`로 설정하여 빈 비밀번호 처리
                ->dehydrated(fn(?string $state): bool => filled($state)) // 기존 비밀번호 유지 시 필드 데이터를 제외
                ->required(fn(): bool => $operation === 'create')
                ->confirmed()
                ->label('비밀번호')
                ->hint($operation === 'edit' ? '비밀번호를 변경하려면 입력하세요.' : null),
            Forms\Components\TextInput::make('password_confirmation')
                ->password()
                ->required(fn(): bool => $operation === 'create')
                ->label('비밀번호 확인'),
            Forms\Components\TextInput::make('points')
                ->numeric()
                ->required()
                ->default(100000)
                ->label('보유 칩')
                ->default($dataForDefaults['points'] ?? 100000),
            Forms\Components\Toggle::make('is_active')
                ->label('활성 여부')
                ->default(false)
                ->default($dataForDefaults['is_active'] ?? false),
        ];
    }

    protected function getFormSchema(): array
    {
        return [
            Forms\Components\Section::make('로봇 생성')
                ->description('지정된 개수만큼의 로봇 계정을 생성합니다. 기존에 존재하는 이메일의 로봇은 건너뛰며, 생성 후 아래 목록에 바로 반영됩니다. 로봇 이름은 "로봇N" 형태로 자동 생성됩니다.')
                ->schema([
                    Forms\Components\TextInput::make('robotCountToGenerate')
                        ->numeric()
                        ->minValue(1)
                        ->maxValue(100)
                        ->default(5)
                        ->label('생성할 로봇 개수')
                        ->required(),
                ]),
            Forms\Components\Section::make('로봇 게임 제어')
                ->description('활성 상태의 로봇들을 게임에 참여시키거나 정지시킵니다. "활성 여부"가 true인 로봇만 시작 가능합니다.')
                ->schema([
                    Forms\Components\TextInput::make('robotCountToStart')
                        ->numeric()
                        ->minValue(1)
                        ->default(fn() => Robot::where('is_active', false)->count())
                        ->label('시작할 로봇 개수 (현재 비활성 로봇 중)')
                        ->required(),
                ]),
        ];
    }

    public function generateRobotsAction(): void
    {
        set_time_limit(120); // ✨ NEW: 실행 시간 제한 120초로 증가

        $count = $this->data['robotCountToGenerate'] ?? 0;
        if ($count <= 0) {
            Notification::make()->title('생성할 로봇 개수를 입력해주세요.')->danger()->send();
            return;
        }

        try {
            $newRobots = RobotManager::generateRobots($count, '로봇', 'password');
            Notification::make()->title($newRobots->count() . '개의 로봇이 생성(또는 스킵)되었습니다.')->success()->send();

            // ✨ MODIFIED: 테이블 새로고침은 액션 성공 시 Filament가 자동으로 처리합니다.
            // 대신, 폼 필드 업데이트를 위해 $this->fill()을 호출합니다.
            $this->fill(['data' => ['robotCountToStart' => Robot::where('is_active', false)->count()]]);
            // 또는 `$this->form->fill(['robotCountToStart' => Robot::where('is_active', false)->count()]);`
        } catch (\Exception $e) {
            Notification::make()->title('로봇 생성 실패')->body($e->getMessage())->danger()->send();
        }
    }

    public function startRobotsAction(): void
    {
        set_time_limit(300); // ✨ MODIFIED: 실행 시간 제한 300초로 증가 (로봇 생성)
        /** @var \App\Models\User|null $user */
        $user = Auth::user();
        if (!$user instanceof \App\Models\User) {
            Notification::make()->title('인증된 사용자 정보를 찾을 수 없습니다.')->danger()->send();
            return;
        }

        $robotCountToStart = $this->data['robotCountToStart'] ?? 1;

        $inactiveRobots = Robot::where('is_active', false)
            ->take($robotCountToStart)
            ->get();

        if ($inactiveRobots->isEmpty()) {
            Notification::make()->title('로봇 시작 실패')->body('시작할 비활성 로봇이 없습니다.')->danger()->send();
            return;
        }

        try {
            $response = Http::withHeaders([
                'X-Game-Server-API-Secret' => config('services.game_server.api_secret'),
            ])->post(env('GAME_SERVER_URL', 'http://localhost:3000') . '/api/robot-commands/start', [
                'robots' => $inactiveRobots->toArray(),
            ]);

            if ($response->successful()) {
                Notification::make()->title('로봇 시작 명령 성공')->body($response->json('message'))->success()->send();
                // ✨ MODIFIED: 테이블 새로고침은 액션 성공 시 Filament가 자동으로 처리합니다.
                // 폼 필드 업데이트를 위해 $this->fill()을 호출합니다.
                $this->fill(['data' => ['robotCountToStart' => Robot::where('is_active', false)->count()]]);
            } else {
                Notification::make()->title('로봇 시작 명령 실패')->body($response->json('message') ?: $response->body())->danger()->send();
            }
        } catch (\Exception | \Throwable $e) {
            Log::error("Filament 로봇 시작 액션 중 예외 발생: {$e->getMessage()}");
            Notification::make()->title('로봇 시작 실패')->body($e->getMessage())->danger()->send();
        }
    }

    public function stopRobotsAction(): void
    {
        set_time_limit(300); // ✨ MODIFIED: 실행 시간 제한 300초로 증가 (로봇 생성)
        /** @var \App\Models\User|null $user */
        $user = Auth::user();
        if (!$user instanceof \App\Models\User) {
            Notification::make()->title('인증된 사용자 정보를 찾을 수 없습니다.')->danger()->send();
            return;
        }

        try {
            $response = Http::withHeaders([
                'X-Game-Server-API-Secret' => config('services.game_server.api_secret'),
            ])->post(env('GAME_SERVER_URL', 'http://localhost:3000') . '/api/robot-commands/stop');

            if ($response->successful()) {
                Notification::make()->title('모든 로봇 정지 명령 성공')->body($response->json('message'))->success()->send();
                // ✨ MODIFIED: 테이블 새로고침은 액션 성공 시 Filament가 자동으로 처리합니다.
                // 폼 필드 업데이트를 위해 $this->fill()을 호출합니다.
                $this->fill(['data' => ['robotCountToStart' => Robot::where('is_active', false)->count()]]);
            } else {
                Notification::make()->title('모든 로봇 정지 명령 실패')->body($response->json('message') ?: $response->body())->danger()->send();
            }
        } catch (\Exception | \Throwable $e) {
            Log::error("Filament 로봇 정지 액션 중 예외 발생: {$e->getMessage()}");
            Notification::make()->title('로봇 정지 실패')->body($e->getMessage())->danger()->send();
        }
    }
}