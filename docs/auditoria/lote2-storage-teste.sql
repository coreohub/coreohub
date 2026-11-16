DO $$
DECLARE r record; stranger uuid := gen_random_uuid(); n int; res text := '';
BEGIN
  SELECT id, user_id INTO r FROM public.registrations WHERE user_id IS NOT NULL LIMIT 1;
  -- função de caminho
  PERFORM set_config('request.jwt.claims', json_build_object('sub', r.user_id, 'role','authenticated')::text, true);
  res := res || 'dono_audios=' || public.trilha_audio_path_allowed('audios/'||r.id||'-x-1.mp3');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role','authenticated')::text, true);
  res := res || ' estranho_audios=' || public.trilha_audio_path_allowed('audios/'||r.id||'-x-1.mp3');
  res := res || ' lixo=' || public.trilha_audio_path_allowed('audios/nao-e-uuid.mp3');
  -- escrita real no bucket como usuário comum
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('trilhas','audios/'||r.id||'-teste.mp3', stranger);
    res := res || ' estranho_insert=PERMITIU';
  EXCEPTION WHEN OTHERS THEN res := res || ' estranho_insert=BLOQUEADO';
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('certificados','x/teste.pdf', stranger);
    res := res || ' certificados_insert=PERMITIU';
  EXCEPTION WHEN OTHERS THEN res := res || ' certificados_insert=BLOQUEADO';
  END;
  RESET ROLE;
  RAISE EXCEPTION 'RESULTADO_DO_TESTE:%', res;
END $$;
