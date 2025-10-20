<x-filament-panels::page>
    {{-- 로봇 생성 및 제어 섹션 --}}
    <div class="mb-6">
        <form wire:submit.prevent="">
            {{ $this->form }}
        </form>
    </div>

    {{-- 로봇 목록 테이블 --}}
    <div>
        {{ $this->table }}
    </div>

    {{-- ✨ REMOVED: @push('scripts') 블록과 그 안의 모든 JavaScript 코드 --}}
</x-filament-panels::page>