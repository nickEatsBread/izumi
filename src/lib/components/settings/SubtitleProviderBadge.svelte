<script lang="ts">
  let { provider }: { provider: 'opensubtitles' | 'subdl' | 'jimaku' } = $props()

  const JIMAKU_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACKUlEQVR4AWMAAiYuOfNaHjmL5zzyFv94FSz/0xKD7ADZBbSzBmg3IwMP0HKIJP0xl7xFFcgBL8k1gF/R8j+fIkWh8ZSBXM2iqlb/104I/r+0KwjoEPKjg2wHaBrb/j+yIAKMJTSsyA4FqjhAUsOaeg7QNbP7v7wn6P++2WH/980Jx4n3AzHUAWD2Pnx4dvj/lb3B/w0t7Qg7oLXEF2QoTXB3hR9hB/RX+4MUgx1i5eBAFdxQ6AM2c2p9APEOyE/xpFp+z0zwGEIO6Cz3AyvOSPAA8+2cHMCJcnV/MEl4cWfQf31zSKJLjnYHmQnyHGEHaACzV3q8+39pLUjWSot1JzvR+fk6g8wAZ9O0OPf/2qa2pJcDAkqgUHD87+hKGOcme8Atn1LnT1QxzUCdeIY4ctfMMLDlK3qCoCFIYwdEhbr+Dwt2BSeyg3MhBdPK3qD/Sno2tC+KVQxsMOJ8WoM/yOf0rwv2zAr7nxLjDqsVyXYAOOgy4j3+ZycRxpU53nAHNBb6EKMHnLVVDW1xO6AKYiitMKyIx+0AUxt7cIXRW0UYT2sIgBs6uc6fGD1gs63tHaifBuR0rOnTIBl1wKgDFIHlhBowH6sCS8H4SDew5Yfnh/8XU6NDq1jLxBZW3kMwIgtSVIkxENsflAcG85apoXCL9wJbzZ3lvtDgp6BjAuooktIVk9GyBmEgmyod1WcMoF7qwHVOzath3fMakGvo1T0H2QXqGYO65wB9QZx5IhwsmQAAAABJRU5ErkJggg=='
</script>

{#if provider === 'opensubtitles'}
  <span class="grid size-9 place-items-center overflow-hidden rounded-lg bg-white" aria-hidden="true">
    <img src="https://avatars.githubusercontent.com/u/23124417?v=4" alt="" class="size-full object-cover" referrerpolicy="no-referrer" />
  </span>
{:else if provider === 'subdl'}
  <span class="grid size-9 place-items-center overflow-hidden rounded-lg bg-[#ffee2b]" aria-hidden="true">
    <svg viewBox="0 0 73 65" class="size-full" role="presentation">
      <path fill="#FFEE2B" d="M0 0h73v65H0z"></path>
      <path d="M19.556 41.3h-3.052v-1.848h-3.668V41.3l6.72 7.98v5.488L18.352 56h-7.336l-1.232-1.232v-3.64h3.052v1.82h3.668v-1.82l-6.72-8.008v-5.488l1.232-1.232h7.336l1.204 1.232V41.3zm9.164-4.9h3.052v18.396L30.568 56h-7.364l-1.232-1.204V36.4h3.052v16.548h3.696V36.4zm15.267 1.232v7.364L42.783 46.2l1.204 1.204v7.364L42.783 56h-8.596V36.4h8.596l1.204 1.232zm-3.052 1.848h-3.668v5.516h3.668V39.48zm-3.668 13.44h3.668v-4.9h-3.668v4.9zM55.026 36.4l1.176 1.232v17.136L55.026 56h-8.624V36.4h8.624zM53.15 52.948V39.48h-3.668v13.468h3.668zm8.519 0H67.1V56h-8.484V36.4h3.052v16.548z" fill="#000"></path>
    </svg>
  </span>
{:else}
  <span class="grid size-9 place-items-center overflow-hidden rounded-lg bg-black" aria-hidden="true">
    <img src={JIMAKU_ICON} alt="" class="size-full object-cover" />
  </span>
{/if}
