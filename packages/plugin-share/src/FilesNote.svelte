<script lang="ts">
	/**
	 * In Settings → Privacy, with `files` (#148): when a shared image can reach a server. The worker
	 * keeps shares on the device, but a share made before it runs is a plain POST to the server.
	 */
	import { brand } from '@xcwds/sveltekit';

	const host = typeof location === 'undefined' ? 'the server it is loaded from' : location.host;
</script>

<p class="text-sm" data-testid="share-files-note">
	Images shared into {brand.name} stay on this device. One exception: an image shared before {brand.name}
	has finished setting up here (right after installing it, or after its data was cleared) is uploaded
	to {host}, where {brand.name} is loaded from. Open {brand.name} once before sharing into it.
</p>
