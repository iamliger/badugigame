<x-filament-panels::page>
    {{-- 로봇 생성 및 제어 섹션 --}}
    <div class="mb-6">
        <form wire:submit.prevent="">
            {{ $this->form }}

            <div class="mt-6 flex gap-3">
                @foreach ($this->getFormActions() as $action)
                    {{ $action }}
                @endforeach
            </div>
        </form>
    </div>

    {{-- 로봇 목록 테이블 --}}
    <div>
        {{ $this->table }}
    </div>
</x-filament-panels::page>