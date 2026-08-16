export default async function backupToDrive(req, base44) {
  try {
    // Get Google Drive access token
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    if (!accessToken) return Response.json({ error: 'No Google Drive token' }, { status: 500 });

    const authHeader = { Authorization: `Bearer ${accessToken}` };

    // 1. Find or create the "Gold Sniper Backups" folder
    const folderQuery = encodeURIComponent("name='Gold Sniper Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const folderRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`,
      { headers: authHeader }
    );
    const folderData = await folderRes.json();
    let folderId;

    if (folderData.files && folderData.files.length > 0) {
      folderId = folderData.files[0].id;
    } else {
      const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Gold Sniper Backups',
          mimeType: 'application/vnd.google-apps.folder'
        })
      });
      const folder = await createFolderRes.json();
      folderId = folder.id;
    }

    // 2. Fetch all data
    const alerts = await base44.asServiceRole.entities.Alert.list({ limit: 500 });
    const tradingStates = await base44.asServiceRole.entities.TradingState.list({ limit: 10 });

    // 3. Build the backup JSON
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const backupData = {
      project: 'Gold Sniper',
      backupDate: timestamp,
      stats: {
        alertCount: alerts.length,
        tradingStateCount: tradingStates.length,
      },
      alerts: alerts,
      tradingStates: tradingStates,
    };

    const backupJson = JSON.stringify(backupData, null, 2);

    // 4. Upload JSON backup to Drive (multipart upload)
    const dateStr = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
    const fileName = `gold_sniper_backup_${dateStr}_${timeStr}.json`;
    const metadata = {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/json'
    };

    const boundary = 'gold_sniper_boundary_2024';
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${backupJson}\r\n--${boundary}--`;

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: body
    });
    const uploadResult = await uploadRes.json();

    // 5. Also update a "latest_state.json" that always has the most current data
    const latestMeta = {
      name: 'gold_sniper_latest_state.json',
      parents: [folderId],
      mimeType: 'application/json'
    };

    // Check if latest_state already exists
    const latestQuery = encodeURIComponent("name='gold_sniper_latest_state.json' and trashed=false");
    const latestSearch = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${latestQuery}&fields=files(id)`,
      { headers: authHeader }
    );
    const latestSearchData = await latestSearch.json();
    const existingLatestId = latestSearchData.files && latestSearchData.files.length > 0 ? latestSearchData.files[0].id : null;

    const latestBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(latestMeta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${backupJson}\r\n--${boundary}--`;

    let latestResult;
    if (existingLatestId) {
      // Update existing file
      const updateRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingLatestId}?uploadType=multipart&fields=id,name`,
        {
          method: 'PATCH',
          headers: { ...authHeader, 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: latestBody
        }
      );
      latestResult = await updateRes.json();
    } else {
      // Create new file
      const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: latestBody
      });
      latestResult = await createRes.json();
    }

    return Response.json({
      success: true,
      message: 'Backup uploaded to Google Drive',
      folder: 'Gold Sniper Backups',
      file: fileName,
      fileId: uploadResult.id,
      latestStateId: latestResult.id,
      alerts: alerts.length,
      tradingStates: tradingStates.length,
      backupDate: timestamp
    });
  } catch (err) {
    console.error('Backup error:', err);
    return Response.json({ error: err.message || 'Backup failed' }, { status: 500 });
  }
}
